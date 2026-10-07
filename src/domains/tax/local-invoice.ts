import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey } from "@/lib/business-date";
import { lockCustomerLedger } from "@/domains/billing/ledger";
import { computeTax } from "./engine";
import { getAgreementTaxContext } from "./locations";
import type { InvoiceLineItemKind } from "./categories";

export type LocalInvoiceTaxResult =
  | { ok: true; totalTaxCents: number }
  | { ok: false; problems: string[] };

type LocalInvoiceTaxInput = {
  invoiceId: string;
  agreementId: string;
  taxDate: Date;
  actorUserId: string | null;
};

/**
 * Rebuild the tax breakdown for a local (non-Stripe) invoice from the canonical
 * address/jurisdiction engine. The visible invoice keeps one combined TAX line,
 * while InvoiceTaxLine preserves the per-jurisdiction evidence used by returns.
 *
 * Tax uncertainty never escapes as an exception: the invoice stays DRAFT, with
 * its ordinary charge lines intact and an audit record that feeds Today.
 */
export async function applyLocalInvoiceTaxInTx(
  tx: Prisma.TransactionClient,
  input: LocalInvoiceTaxInput,
): Promise<LocalInvoiceTaxResult> {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
    select: {
      subtotalCents: true,
      discountCents: true,
      lateFeeCents: true,
      lineItems: {
        where: { kind: { not: "TAX" } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, kind: true, amountCents: true },
      },
    },
  });

  const agreement = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: input.agreementId },
    select: { serviceAddressId: true },
  });
  const location = await tx.addressTaxLocation.findFirst({
    where: { serviceAddressId: agreement.serviceAddressId, isCurrent: true },
    select: {
      status: true,
      jurisdictions: {
        select: {
          jurisdiction: { select: { name: true, reviewStatus: true } },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const readinessProblems: string[] = [];
  if (!location || location.status !== "VERIFIED") {
    readinessProblems.push("Confirm the tax areas for this service address before billing.");
  }
  for (const row of location?.jurisdictions ?? []) {
    if (row.jurisdiction.reviewStatus !== "REVIEWED") {
      readinessProblems.push(`Review ${row.jurisdiction.name} before billing.`);
    }
  }

  const context = await getAgreementTaxContext(tx, input.agreementId, input.taxDate);
  const engineResult = computeTax({
    ...context,
    lines: invoice.lineItems.map((line) => ({
      key: line.id,
      kind: line.kind as InvoiceLineItemKind,
      amountCents: line.amountCents,
    })),
  });
  const result =
    readinessProblems.length > 0
      ? {
          ok: false as const,
          problems: [
            ...new Set([
              ...readinessProblems,
              ...(engineResult.ok ? [] : engineResult.problems),
            ]),
          ],
        }
      : engineResult;

  // A recalculation replaces only engine-owned evidence and the single visible
  // tax total. Stripe evidence is never edited here.
  await tx.invoiceTaxLine.deleteMany({
    where: { invoiceId: input.invoiceId, source: "ENGINE" },
  });
  await tx.invoiceLineItem.deleteMany({
    where: { invoiceId: input.invoiceId, kind: "TAX" },
  });

  const baseDueCents =
    invoice.subtotalCents - invoice.discountCents + invoice.lateFeeCents;

  if (!result.ok) {
    await tx.invoice.update({
      where: { id: input.invoiceId },
      data: {
        status: "DRAFT",
        taxCents: 0,
        amountDueCents: baseDueCents,
        version: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.actorUserId,
        action: "billing.invoice_tax_blocked",
        entityType: "Invoice",
        entityId: input.invoiceId,
        newValue: {
          agreementId: input.agreementId,
          taxDate: businessDateKey(input.taxDate),
          problems: result.problems,
        },
      },
    });
    return result;
  }

  if (result.lines.length > 0) {
    await tx.invoiceTaxLine.createMany({
      data: result.lines.map((line) => ({
        invoiceId: input.invoiceId,
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

  if (result.totalTaxCents !== 0) {
    await tx.invoiceLineItem.create({
      data: {
        invoiceId: input.invoiceId,
        kind: "TAX",
        description: "Sales tax",
        amountCents: result.totalTaxCents,
        quantity: 1,
      },
    });
  }

  await tx.invoice.update({
    where: { id: input.invoiceId },
    data: {
      status: "OPEN",
      taxCents: result.totalTaxCents,
      amountDueCents: baseDueCents + result.totalTaxCents,
      version: { increment: 1 },
    },
  });
  await tx.auditLog.create({
    data: {
      userId: input.actorUserId,
      action: "billing.invoice_tax_calculated",
      entityType: "Invoice",
      entityId: input.invoiceId,
      newValue: {
        agreementId: input.agreementId,
        taxDate: businessDateKey(input.taxDate),
        taxCents: result.totalTaxCents,
        jurisdictionCount: new Set(result.lines.map((line) => line.jurisdictionId)).size,
      },
    },
  });
  return { ok: true, totalTaxCents: result.totalTaxCents };
}

/** Owner/admin recovery action for a DRAFT local invoice after tax setup is fixed. */
export async function recalculateLocalInvoiceTax(
  actorUserId: string,
  invoiceId: string,
): Promise<LocalInvoiceTaxResult> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: {
        id: true,
        customerId: true,
        agreementId: true,
        status: true,
        billingPeriodEnd: true,
        dueDate: true,
        createdAt: true,
      },
    });
    if (!invoice.agreementId) {
      throw new Error("This invoice is not linked to a rental agreement, so its address tax cannot be recalculated here.");
    }
    if (invoice.status !== "DRAFT") {
      throw new Error("Only a draft invoice waiting on tax can be recalculated.");
    }

    await lockCustomerLedger(tx, invoice.customerId);
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoice.id} FOR UPDATE`;

    const locked = await tx.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      select: { status: true, billingPeriodEnd: true, dueDate: true, createdAt: true },
    });
    if (locked.status !== "DRAFT") {
      throw new Error("This invoice changed while you were working. Reload it before trying again.");
    }

    return applyLocalInvoiceTaxInTx(tx, {
      invoiceId: invoice.id,
      agreementId: invoice.agreementId,
      taxDate: locked.billingPeriodEnd ?? locked.dueDate ?? locked.createdAt,
      actorUserId,
    });
  });
}
