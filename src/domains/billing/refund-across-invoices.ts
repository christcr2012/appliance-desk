import type { Prisma } from "@prisma/client";

import { allocateAcrossLines } from "@/domains/tax/allocate";
import { prepareInvoiceRefundInTx, type ClaimedRefund } from "./refunds";

export type RefundAcrossRun = {
  refundId: string;
  claim: ClaimedRefund;
  invoiceId: string;
  amountCents: number;
};

export type RentalItemInvoiceEvidence = {
  invoiceId: string;
  invoiceDate: Date;
  baseCents: number;
  taxCents: number;
  grossCents: number;
  refundableCents: number;
  evidenceComplete: boolean;
};

function remainingRefundableCents(invoice: {
  amountPaidCents: number;
  refunds: Array<{ amountCents: number }>;
}): number {
  return Math.max(
    0,
    invoice.amountPaidCents -
      invoice.refunds.reduce((sum, refund) => sum + refund.amountCents, 0),
  );
}

export async function billedRentalLineEvidenceInTx(
  tx: Prisma.TransactionClient,
  input: { agreementId: string; rentalLineId: string },
): Promise<{
  baseCents: number;
  taxCents: number;
  totalCents: number;
  evidenceComplete: boolean;
}> {
  const lines = await tx.invoiceLineItem.findMany({
    where: {
      rentalLineId: input.rentalLineId,
      kind: "RENTAL",
      invoice: {
        agreementId: input.agreementId,
        status: { notIn: ["VOID", "DRAFT"] },
      },
    },
    select: {
      amountCents: true,
      invoice: { select: { taxCents: true } },
      taxLines: { select: { taxCents: true } },
    },
  });

  const baseCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const taxCents = lines.reduce(
    (sum, line) =>
      sum +
      line.taxLines.reduce((taxSum, taxLine) => taxSum + taxLine.taxCents, 0),
    0,
  );
  const evidenceComplete = lines.every(
    (line) => line.taxLines.length > 0 || line.invoice.taxCents === 0,
  );
  return {
    baseCents,
    taxCents,
    totalCents: baseCents + taxCents,
    evidenceComplete,
  };
}

/**
 * Historical per-invoice charge evidence for one appliance on a rental line.
 *
 * The invoice's own line amount is split across the assignments that were
 * active for that billing period, not across today's reduced line price.
 * Therefore a later never-delivered removal still gets the same historical
 * share even after an earlier item's line amendment reduced future billing.
 */
export async function rentalItemInvoiceEvidenceInTx(
  tx: Prisma.TransactionClient,
  input: {
    agreementId: string;
    rentalLineId: string;
    applianceId: string;
  },
): Promise<RentalItemInvoiceEvidence[]> {
  const assignments = await tx.applianceAssignment.findMany({
    where: { rentalLineId: input.rentalLineId },
    select: {
      id: true,
      applianceId: true,
      assignedAt: true,
      unassignedAt: true,
    },
    orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
  });

  const lines = await tx.invoiceLineItem.findMany({
    where: {
      rentalLineId: input.rentalLineId,
      kind: "RENTAL",
      amountCents: { gt: 0 },
      invoice: {
        agreementId: input.agreementId,
        amountPaidCents: { gt: 0 },
        status: { notIn: ["VOID", "DRAFT"] },
      },
    },
    orderBy: [
      { invoice: { billingPeriodStart: "desc" } },
      { invoice: { createdAt: "desc" } },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    select: {
      amountCents: true,
      taxLines: { select: { taxCents: true } },
      invoice: {
        select: {
          id: true,
          taxCents: true,
          amountPaidCents: true,
          billingPeriodStart: true,
          createdAt: true,
          refunds: { select: { amountCents: true } },
        },
      },
    },
  });

  const byInvoice = new Map<string, RentalItemInvoiceEvidence>();
  for (const line of lines) {
    const invoiceDate =
      line.invoice.billingPeriodStart ?? line.invoice.createdAt;
    const active = assignments.filter(
      (assignment) =>
        assignment.assignedAt.getTime() <= invoiceDate.getTime() &&
        (assignment.unassignedAt === null ||
          assignment.unassignedAt.getTime() > invoiceDate.getTime()),
    );
    const targetIndex = active.findIndex(
      (assignment) => assignment.applianceId === input.applianceId,
    );
    if (targetIndex < 0 || active.length === 0) continue;

    const weights = active.map(() => 1);
    const baseCents = allocateAcrossLines(line.amountCents, weights)[targetIndex];
    const evidenceComplete =
      line.taxLines.length > 0 || line.invoice.taxCents === 0;
    const taxCents = line.taxLines.reduce(
      (sum, taxLine) =>
        sum + allocateAcrossLines(taxLine.taxCents, weights)[targetIndex],
      0,
    );

    const existing = byInvoice.get(line.invoice.id);
    if (existing) {
      existing.baseCents += baseCents;
      existing.taxCents += taxCents;
      existing.grossCents += baseCents + taxCents;
      existing.evidenceComplete =
        existing.evidenceComplete && evidenceComplete;
      continue;
    }

    byInvoice.set(line.invoice.id, {
      invoiceId: line.invoice.id,
      invoiceDate,
      baseCents,
      taxCents,
      grossCents: baseCents + taxCents,
      refundableCents: remainingRefundableCents(line.invoice),
      evidenceComplete,
    });
  }

  return [...byInvoice.values()];
}

/**
 * Refund exactly the paid historical charges for one appliance. Only invoices
 * that actually contain that appliance's rental-line share are eligible; an
 * unrelated paid invoice can never fund the refund. Existing invoice refunds
 * reduce the source invoice's remaining capacity before a new refund is made.
 */
export async function refundRentalItemAcrossPaidInvoicesInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  input: {
    agreementId: string;
    rentalLineId: string;
    applianceId: string;
    reason: "BILLING_ERROR" | "OTHER";
    notes: string;
  },
): Promise<{
  requestedCents: number;
  refundedCents: number;
  refundByHandCents: number;
  runs: RefundAcrossRun[];
  refundIds: string[];
  unpaidCents: number;
}> {
  const evidence = await rentalItemInvoiceEvidenceInTx(tx, input);
  if (evidence.some((row) => !row.evidenceComplete)) {
    throw new Error(
      "This rental has older paid tax that is missing line-level tax evidence. Review the historical bill before removing this never-delivered item.",
    );
  }

  const requestedCents = evidence.reduce(
    (sum, row) => sum + row.grossCents,
    0,
  );
  let plannedCents = 0;
  const plans: Array<{ invoiceId: string; amountCents: number }> = [];
  for (const row of evidence) {
    const amountCents = Math.min(row.grossCents, row.refundableCents);
    if (amountCents <= 0) continue;
    plans.push({ invoiceId: row.invoiceId, amountCents });
    plannedCents += amountCents;
  }

  let refundedCents = 0;
  let refundByHandCents = 0;
  const runs: RefundAcrossRun[] = [];
  const refundIds: string[] = [];

  for (const plan of plans) {
    const prepared = await prepareInvoiceRefundInTx(tx, userId, {
      invoiceId: plan.invoiceId,
      amountCents: plan.amountCents,
      reason: input.reason,
      notes: input.notes,
    });
    refundIds.push(prepared.refundId);
    if (prepared.claim) {
      runs.push({
        refundId: prepared.refundId,
        claim: prepared.claim,
        invoiceId: plan.invoiceId,
        amountCents: plan.amountCents,
      });
      refundedCents += plan.amountCents;
    } else {
      refundByHandCents += plan.amountCents;
    }
  }

  return {
    requestedCents,
    refundedCents,
    refundByHandCents,
    runs,
    refundIds,
    unpaidCents: requestedCents - plannedCents,
  };
}

/**
 * Tax reversal for rental base being unwound. Evidence is consumed from the
 * same newest-to-oldest invoices that still have refundable paid balance, so
 * an unpaid invoice or a fully refunded invoice can never lend its tax rate to
 * money actually returned from another bill.
 */
export async function historicalRentalTaxForBaseCentsInTx(
  tx: Prisma.TransactionClient,
  input: { agreementId: string; baseCents: number },
): Promise<{
  taxCents: number;
  uncoveredBaseCents: number;
  evidenceComplete: boolean;
}> {
  let remainingBaseCents = Math.max(0, input.baseCents);
  let taxCents = 0;
  let evidenceComplete = true;

  const invoices =
    remainingBaseCents > 0
      ? await tx.invoice.findMany({
          where: {
            agreementId: input.agreementId,
            amountPaidCents: { gt: 0 },
            status: { notIn: ["VOID", "DRAFT"] },
          },
          orderBy: [
            { billingPeriodStart: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
          select: {
            id: true,
            taxCents: true,
            amountPaidCents: true,
            refunds: { select: { amountCents: true } },
            lineItems: {
              where: { kind: "RENTAL", amountCents: { gt: 0 } },
              select: {
                amountCents: true,
                taxLines: { select: { taxCents: true } },
              },
            },
          },
        })
      : [];

  for (const invoice of invoices) {
    if (remainingBaseCents <= 0) break;
    const refundableCents = remainingRefundableCents(invoice);
    if (refundableCents <= 0) continue;

    const rentalBaseCents = invoice.lineItems.reduce(
      (sum, line) => sum + line.amountCents,
      0,
    );
    if (rentalBaseCents <= 0) continue;

    const invoiceEvidenceComplete = invoice.lineItems.every(
      (line) => line.taxLines.length > 0 || invoice.taxCents === 0,
    );
    if (!invoiceEvidenceComplete) evidenceComplete = false;

    const rentalTaxCents = invoice.lineItems.reduce(
      (sum, line) =>
        sum +
        line.taxLines.reduce(
          (taxSum, taxLine) => taxSum + taxLine.taxCents,
          0,
        ),
      0,
    );
    const rentalGrossCents = rentalBaseCents + rentalTaxCents;
    const availableGrossCents = Math.min(
      refundableCents,
      rentalGrossCents,
    );
    const [availableBaseCents, availableTaxCents] = allocateAcrossLines(
      availableGrossCents,
      [rentalBaseCents, rentalTaxCents],
    );
    if (availableBaseCents <= 0) continue;

    const takeBaseCents = Math.min(
      remainingBaseCents,
      availableBaseCents,
    );
    const takeTaxCents = allocateAcrossLines(availableTaxCents, [
      takeBaseCents,
      availableBaseCents - takeBaseCents,
    ])[0];

    taxCents += takeTaxCents;
    remainingBaseCents -= takeBaseCents;
  }

  return {
    taxCents,
    uncoveredBaseCents: remainingBaseCents,
    evidenceComplete,
  };
}

/**
 * Pay money back to a customer for an agreement: the newest paid invoices
 * first. A Stripe-paid invoice is refunded to the original card or bank
 * through Stripe; money paid another way is recorded for the owner to pay
 * back by hand. Whatever was billed but never paid is left in unpaidCents.
 */
export async function refundAcrossPaidInvoicesInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  input: {
    agreementId: string;
    amountCents: number;
    reason: "BILLING_ERROR" | "OTHER";
    notes: string;
  },
): Promise<{
  refundedCents: number;
  refundByHandCents: number;
  runs: RefundAcrossRun[];
  refundIds: string[];
  unpaidCents: number;
}> {
  let remaining = input.amountCents;
  let refundedCents = 0;
  let refundByHandCents = 0;
  const runs: RefundAcrossRun[] = [];
  const refundIds: string[] = [];
  const invoices =
    remaining > 0
      ? await tx.invoice.findMany({
          where: {
            agreementId: input.agreementId,
            amountPaidCents: { gt: 0 },
            status: { notIn: ["VOID", "DRAFT"] },
          },
          orderBy: [
            { billingPeriodStart: "desc" },
            { createdAt: "desc" },
          ],
          select: {
            id: true,
            amountPaidCents: true,
            refunds: { select: { amountCents: true } },
          },
        })
      : [];
  for (const invoice of invoices) {
    if (remaining <= 0) break;
    const refundable = remainingRefundableCents(invoice);
    const chunk = Math.min(remaining, refundable);
    if (chunk <= 0) continue;
    const prepared = await prepareInvoiceRefundInTx(tx, userId, {
      invoiceId: invoice.id,
      amountCents: chunk,
      reason: input.reason,
      notes: input.notes,
    });
    refundIds.push(prepared.refundId);
    if (prepared.claim) {
      runs.push({
        refundId: prepared.refundId,
        claim: prepared.claim,
        invoiceId: invoice.id,
        amountCents: chunk,
      });
      refundedCents += chunk;
    } else {
      refundByHandCents += chunk;
    }
    remaining -= chunk;
  }
  return {
    refundedCents,
    refundByHandCents,
    runs,
    refundIds,
    unpaidCents: remaining,
  };
}
