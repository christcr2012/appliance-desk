import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { formatCents } from "@/domains/pricing/money";
import { lockCustomerLedger } from "./ledger";
import { taxCentsForLine } from "./tax";

/**
 * "Who caused the delay?" When the business, not the customer, made a pickup late, the owner or an admin waives the
 * late-return days (docs/archive/designs-completed/BATCH-B2.md WU-B2-9). The original charge stays on the invoice for the record; a
 * negative LATE_RETURN_WAIVER line (and matching tax line) takes it off. Done once per job.
 */

/** Cents waived for `waivedDays` of a charge that was `days` long: the whole charge when all days are waived, else rounded half up. */
export function lateReturnWaiverCents(charge: { days: number; amountCents: number }, waivedDays: number): number {
  if (charge.days <= 0 || waivedDays <= 0) return 0;
  if (waivedDays >= charge.days) return charge.amountCents;
  return Math.floor((2 * charge.amountCents * waivedDays + charge.days) / (2 * charge.days));
}

type AuditItem = { description: string; days: number };

export async function recordLateReturnWaiverInTx(
  tx: Prisma.TransactionClient,
  actor: { userId: string },
  input: { jobId: string; waivedDays: number | null; note: string },
): Promise<{ waiverId: string; waivedCents: number; waivedTaxCents: number }> {
  await assertActiveTeamActor(tx, actor.userId, ["OWNER", "ADMIN"]);
  const note = input.note.trim();
  if (note.length < 5 || note.length > 500) throw new Error("Add a note (5 to 500 characters) saying why the late days are waived.");
  if (input.waivedDays !== null && (!Number.isInteger(input.waivedDays) || input.waivedDays < 1)) {
    throw new Error("Days to waive must be a whole number of 1 or more, or leave it empty to waive all of them.");
  }
  if (await tx.lateReturnWaiver.findUnique({ where: { jobId: input.jobId }, select: { id: true } })) {
    throw new Error("The late days for this pickup have already been waived.");
  }
  const audit = await tx.auditLog.findFirst({
    where: { action: "billing.late_return_invoiced", newValue: { path: ["jobId"], equals: input.jobId } },
    select: { entityId: true, newValue: true },
  });
  if (!audit?.entityId) throw new Error("There is no late-return charge for this pickup.");
  const invoiceId = audit.entityId;
  const invoiceRef = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { customerId: true } });
  if (!invoiceRef) throw new Error("There is no late-return charge for this pickup.");

  // Lock order: customer ledger, then the invoice.
  await lockCustomerLedger(tx, invoiceRef.customerId);
  await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      lineItems: true,
      taxLines: {
        where: { source: "ENGINE" },
        include: { rateVersion: { select: { rateMilliPercent: true } } },
      },
      payments: { select: { status: true } },
    },
  });
  if (invoice.status !== "OPEN" && invoice.status !== "DELINQUENT") {
    throw new Error("This late-return invoice is no longer open, so the days can't be waived here.");
  }
  const credits = await tx.creditApplication.count({ where: { invoiceId: invoice.id } });
  if (invoice.amountPaidCents > 0 || credits > 0 || invoice.payments.some((p) => p.status.toLowerCase() === "succeeded")) {
    throw new Error("A payment has already been applied to this invoice. Use a refund or credit instead of a waiver.");
  }

  const auditItems = ((audit.newValue as { items?: AuditItem[] } | null)?.items ?? []).filter(
    (i) => typeof i.description === "string" && Number.isInteger(i.days),
  );
  const charged = invoice.lineItems.filter((l) => l.kind === "LATE_RETURN");
  const waiveLines: Array<{ line: (typeof charged)[number]; cents: number; days: number }> = [];
  let maxDays = 0;
  for (const line of charged) {
    const item = auditItems.find((i) => i.description === line.description);
    const days = item?.days ?? 0;
    if (days <= 0) continue;
    const waivedDays = Math.min(input.waivedDays ?? days, days);
    const cents = lateReturnWaiverCents({ days, amountCents: line.amountCents }, waivedDays);
    if (cents > 0) waiveLines.push({ line, cents, days: waivedDays });
    maxDays = Math.max(maxDays, waivedDays);
  }
  if (waiveLines.length === 0) throw new Error("There is nothing to waive on this invoice.");

  const waivedCents = waiveLines.reduce((sum, w) => sum + w.cents, 0);
  const everyChargeFullyWaived = waiveLines.length === charged.length && waiveLines.every((w) => w.cents === w.line.amountCents);
  const existingTax = invoice.lineItems.filter((l) => l.kind === "TAX").reduce((sum, l) => sum + l.amountCents, 0);

  // Create the negative charge lines first so their jurisdiction reversals can
  // point at the exact persisted line item that caused them.
  const createdWaivers = new Map<string, string>();
  for (const w of waiveLines) {
    const row = await tx.invoiceLineItem.create({
      data: {
        invoiceId: invoice.id,
        kind: "LATE_RETURN_WAIVER",
        description: `Waived (our delay): ${w.line.description}`,
        amountCents: -w.cents,
        quantity: 1,
        rentalLineId: w.line.rentalLineId,
      },
      select: { id: true },
    });
    createdWaivers.set(w.line.id, row.id);
  }

  let waivedTaxCents = 0;
  const taxReversals: Array<{
    invoiceId: string;
    invoiceLineItemId: string;
    jurisdictionId: string;
    rateVersionId: string;
    category: "LATE_RETURN";
    taxableCents: number;
    exemptCents: number;
    exemptReason: string | null;
    taxCents: number;
    source: "ENGINE";
  }> = [];

  if (invoice.taxLines.length > 0) {
    for (const w of waiveLines) {
      const waiverLineId = createdWaivers.get(w.line.id);
      if (!waiverLineId) continue;
      for (const taxLine of invoice.taxLines.filter((line) => line.invoiceLineItemId === w.line.id)) {
        const fullyWaived = w.cents === w.line.amountCents;
        const taxableCents =
          taxLine.taxableCents === 0 ? 0 : -w.cents;
        const exemptCents =
          taxLine.exemptCents === 0 ? 0 : -w.cents;
        const taxCents =
          taxLine.taxCents === 0
            ? 0
            : fullyWaived
              ? -taxLine.taxCents
              : -Math.min(
                  Math.abs(taxLine.taxCents),
                  Math.abs(taxCentsForLine(w.cents, taxLine.rateVersion.rateMilliPercent)),
                );
        waivedTaxCents += Math.abs(taxCents);
        taxReversals.push({
          invoiceId: invoice.id,
          invoiceLineItemId: waiverLineId,
          jurisdictionId: taxLine.jurisdictionId,
          rateVersionId: taxLine.rateVersionId,
          category: "LATE_RETURN",
          taxableCents,
          exemptCents,
          exemptReason: taxLine.exemptReason,
          taxCents,
          source: "ENGINE",
        });
      }
    }
  } else if (existingTax > 0) {
    // Legacy late-return invoices created before Batch T have no jurisdiction
    // evidence. Preserve their old combined tax without reading the deprecated
    // agreement snapshot for new arithmetic.
    const chargedCents = charged.reduce((sum, line) => sum + line.amountCents, 0);
    waivedTaxCents = everyChargeFullyWaived
      ? existingTax
      : Math.min(existingTax, Math.round((existingTax * waivedCents) / Math.max(1, chargedCents)));
  }

  if (taxReversals.length > 0) {
    await tx.invoiceTaxLine.createMany({ data: taxReversals });
  }
  if (waivedTaxCents > 0) {
    await tx.invoiceLineItem.create({
      data: {
        invoiceId: invoice.id,
        kind: "TAX",
        description: "Sales tax on waived late days",
        amountCents: -waivedTaxCents,
        quantity: 1,
        rentalLineId: null,
      },
    });
  }
  const amountDueCents = invoice.amountDueCents - waivedCents - waivedTaxCents;
  await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      subtotalCents: invoice.subtotalCents - waivedCents,
      taxCents: invoice.taxCents - waivedTaxCents,
      amountDueCents,
      ...(amountDueCents === 0 ? { status: "PAID" as const } : {}),
      version: { increment: 1 },
    },
  });
  const waiver = await tx.lateReturnWaiver.create({
    data: {
      jobId: input.jobId,
      invoiceId: invoice.id,
      waivedDays: maxDays,
      waivedCents,
      waivedTaxCents,
      note,
      recordedByUserId: actor.userId,
    },
  });
  await tx.auditLog.create({
    data: {
      userId: actor.userId,
      action: "billing.late_return_waived",
      entityType: "Invoice",
      entityId: invoice.id,
      newValue: {
        jobId: input.jobId,
        waivedDays: maxDays,
        waived: formatCents(waivedCents),
        waivedTax: formatCents(waivedTaxCents),
        amountDue: formatCents(amountDueCents),
        note,
      },
    },
  });
  return { waiverId: waiver.id, waivedCents, waivedTaxCents };
}

export async function recordLateReturnWaiver(
  userId: string,
  jobId: string,
  input: { waivedDays: number | null; note: string },
): Promise<void> {
  await prisma.$transaction((tx) => recordLateReturnWaiverInTx(tx, { userId }, { jobId, ...input }));
}

/** What the job page needs to offer "Who caused the delay?": the charged days, or why a waiver is not possible. */
export async function getLateReturnWaiverState(jobId: string): Promise<
  | { kind: "NONE" }
  | { kind: "WAIVED"; waivedCents: number }
  | { kind: "BLOCKED"; reason: string }
  | { kind: "AVAILABLE"; maxDays: number; chargedCents: number }
> {
  const waiver = await prisma.lateReturnWaiver.findUnique({ where: { jobId }, select: { waivedCents: true, waivedTaxCents: true } });
  if (waiver) return { kind: "WAIVED", waivedCents: waiver.waivedCents + waiver.waivedTaxCents };
  const audit = await prisma.auditLog.findFirst({
    where: { action: "billing.late_return_invoiced", newValue: { path: ["jobId"], equals: jobId } },
    select: { entityId: true, newValue: true },
  });
  if (!audit?.entityId) return { kind: "NONE" };
  const invoice = await prisma.invoice.findUnique({
    where: { id: audit.entityId },
    select: { status: true, amountPaidCents: true, amountDueCents: true, payments: { select: { status: true } }, creditApplications: { select: { id: true } } },
  });
  if (!invoice) return { kind: "NONE" };
  const items = ((audit.newValue as { items?: AuditItem[] } | null)?.items ?? []).filter((i) => Number.isInteger(i.days));
  const maxDays = items.reduce((max, i) => Math.max(max, i.days), 0);
  if ((invoice.status !== "OPEN" && invoice.status !== "DELINQUENT") || invoice.amountPaidCents > 0 || invoice.creditApplications.length > 0 || invoice.payments.some((p) => p.status.toLowerCase() === "succeeded")) {
    return { kind: "BLOCKED", reason: "The late-return invoice is already paid or closed, so the days can't be waived. Use a refund or credit instead." };
  }
  return { kind: "AVAILABLE", maxDays, chargedCents: invoice.amountDueCents };
}
