import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { formatCents } from "@/domains/pricing/money";
import { lockCustomerLedger } from "./ledger";
import { computeTax, type EngineJurisdiction } from "@/domains/tax/engine";

/**
 * "Who caused the delay?" When the business, not the customer, made a pickup late, the owner or an admin waives the
 * late-return days (docs/designs/BATCH-B2.md WU-B2-9). The original charge stays on the invoice for the record; a
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
        include: {
          jurisdiction: {
            select: { id: true, code: true, name: true, administration: true },
          },
          rateVersion: {
            select: { id: true, rateMilliPercent: true },
          },
        },
      },
      payments: { select: { status: true } },
      agreement: { select: { termMonths: true } },
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

  const originalTaxByJurisdiction = new Map<
    string,
    (typeof invoice.taxLines)[number]
  >();
  for (const taxLine of invoice.taxLines) {
    if (
      taxLine.category === "LATE_RETURN" &&
      taxLine.invoiceLineItemId &&
      charged.some((line) => line.id === taxLine.invoiceLineItemId) &&
      !originalTaxByJurisdiction.has(taxLine.jurisdictionId)
    ) {
      originalTaxByJurisdiction.set(taxLine.jurisdictionId, taxLine);
    }
  }
  if (originalTaxByJurisdiction.size === 0) {
    throw new Error(
      "This late-return bill has no jurisdiction tax detail, so its tax cannot be waived safely.",
    );
  }

  const persistedWaivers = [];
  for (const waiver of waiveLines) {
    persistedWaivers.push(
      await tx.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          kind: "LATE_RETURN_WAIVER",
          description: `Waived (our delay): ${waiver.line.description}`,
          amountCents: -waiver.cents,
          quantity: 1,
          rentalLineId: waiver.line.rentalLineId,
        },
      }),
    );
  }

  const jurisdictions: EngineJurisdiction[] = [
    ...originalTaxByJurisdiction.values(),
  ].map((taxLine) => ({
    id: taxLine.jurisdiction.id,
    code: taxLine.jurisdiction.code,
    name: taxLine.jurisdiction.name,
    administration: taxLine.jurisdiction.administration,
    rate: {
      versionId: taxLine.rateVersion.id,
      rateMilliPercent: taxLine.rateVersion.rateMilliPercent,
    },
    rules: {
      LATE_RETURN:
        taxLine.taxableCents !== 0 ? ("TAXABLE" as const) : ("EXEMPT" as const),
    },
  }));
  const exemptJurisdictionIds = new Set(
    [...originalTaxByJurisdiction.values()]
      .filter((line) => line.exemptReason === "Customer exemption certificate")
      .map((line) => line.jurisdictionId),
  );
  const taxResult = computeTax({
    taxDate: invoice.dueDate ?? invoice.billingPeriodEnd ?? invoice.createdAt,
    leaseTermMonths: invoice.agreement?.termMonths ?? null,
    election: "COLLECT_ON_RENTALS",
    defaultRules: {},
    jurisdictions,
    exemptJurisdictionIds,
    // A waiver follows the original LATE_RETURN category. Feeding the
    // negative amounts as LATE_RETURN here deliberately reuses that frozen
    // category/rate snapshot instead of today's policy.
    lines: persistedWaivers.map((line) => ({
      key: line.id,
      kind: "LATE_RETURN",
      amountCents: line.amountCents,
    })),
  });
  if (!taxResult.ok) {
    throw new Error(
      `The original tax detail could not be reversed safely: ${taxResult.problems.join(" ")}`,
    );
  }
  const waivedTaxCents = -taxResult.totalTaxCents;
  if (waivedTaxCents < 0) {
    throw new Error("The tax waiver calculation returned an invalid amount.");
  }

  if (taxResult.lines.length > 0) {
    await tx.invoiceTaxLine.createMany({
      data: taxResult.lines.map((line) => ({
        invoiceId: invoice.id,
        invoiceLineItemId: line.lineKey,
        jurisdictionId: line.jurisdictionId,
        rateVersionId: line.rateVersionId,
        category: line.category,
        taxableCents: line.taxableCents,
        exemptCents: line.exemptCents,
        exemptReason: line.exemptReason,
        taxCents: line.taxCents,
        source: "ENGINE" as const,
      })),
    });
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
