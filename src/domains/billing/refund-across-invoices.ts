import type { Prisma } from "@prisma/client";
import { allocateAcrossLines } from "@/domains/tax/allocate";
import { prepareInvoiceRefundInTx, type ClaimedRefund } from "./refunds";

export type RefundAcrossRun = { refundId: string; claim: ClaimedRefund; invoiceId: string; amountCents: number };

export async function billedRentalLineEvidenceInTx(
  tx: Prisma.TransactionClient,
  input: { agreementId: string; rentalLineId: string },
): Promise<{ baseCents: number; taxCents: number; totalCents: number }> {
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
      taxLines: {
        select: { taxCents: true },
      },
    },
  });

  const baseCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const taxCents = lines.reduce(
    (sum, line) =>
      sum + line.taxLines.reduce((taxSum, taxLine) => taxSum + taxLine.taxCents, 0),
    0,
  );
  return { baseCents, taxCents, totalCents: baseCents + taxCents };
}

/**
 * Actual historical billed evidence for one agreement line. Callers that
 * refund only one appliance from a multi-appliance line must allocate their
 * share of both base and tax rather than refunding the whole line.
 */
/**
 * Pay money back to a customer for an agreement: the newest paid invoices first. A Stripe-paid invoice is refunded to
 * the original card or bank through Stripe (the caller runs the returned `runs` after the transaction commits);
 * money paid another way is recorded for the owner to pay back by hand. Whatever was billed but never paid is left
 * over in `unpaidCents` (there is nothing to refund for it). Runs inside the caller's transaction, which must already
 * hold the customer ledger and agreement locks.
 */
export async function historicalRentalTaxForBaseCentsInTx(
  tx: Prisma.TransactionClient,
  input: { agreementId: string; baseCents: number },
): Promise<{ taxCents: number; uncoveredBaseCents: number }> {
  let remainingBaseCents = Math.max(0, input.baseCents);
  let taxCents = 0;
  const lines =
    remainingBaseCents > 0
      ? await tx.invoiceLineItem.findMany({
          where: {
            kind: "RENTAL",
            amountCents: { gt: 0 },
            invoice: {
              agreementId: input.agreementId,
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
          },
        })
      : [];

  for (const line of lines) {
    if (remainingBaseCents <= 0) break;
    const takeBaseCents = Math.min(remainingBaseCents, line.amountCents);
    const lineTaxCents = line.taxLines.reduce(
      (sum, taxLine) => sum + taxLine.taxCents,
      0,
    );
    taxCents += allocateAcrossLines(lineTaxCents, [
      takeBaseCents,
      line.amountCents - takeBaseCents,
    ])[0];
    remainingBaseCents -= takeBaseCents;
  }

  return { taxCents, uncoveredBaseCents: remainingBaseCents };
}

/**
 * Tax reversal for rental base that is being unwound. Newest invoice evidence
 * is consumed first, matching refundAcrossPaidInvoicesInTx's money ordering.
 * No current rate or agreement display snapshot is consulted.
 */
export async function refundAcrossPaidInvoicesInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  input: { agreementId: string; amountCents: number; reason: "BILLING_ERROR" | "OTHER"; notes: string },
): Promise<{ refundedCents: number; refundByHandCents: number; runs: RefundAcrossRun[]; refundIds: string[]; unpaidCents: number }> {
  let remaining = input.amountCents;
  let refundedCents = 0;
  let refundByHandCents = 0;
  const runs: RefundAcrossRun[] = [];
  const refundIds: string[] = [];
  const invoices =
    remaining > 0
      ? await tx.invoice.findMany({
          where: { agreementId: input.agreementId, amountPaidCents: { gt: 0 }, status: { notIn: ["VOID", "DRAFT"] } },
          orderBy: [{ billingPeriodStart: "desc" }, { createdAt: "desc" }],
          select: { id: true, amountPaidCents: true, refunds: { select: { amountCents: true } } },
        })
      : [];
  for (const invoice of invoices) {
    if (remaining <= 0) break;
    const refundable = invoice.amountPaidCents - invoice.refunds.reduce((sum, r) => sum + r.amountCents, 0);
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
      runs.push({ refundId: prepared.refundId, claim: prepared.claim, invoiceId: invoice.id, amountCents: chunk });
      refundedCents += chunk;
    } else {
      refundByHandCents += chunk;
    }
    remaining -= chunk;
  }
  return { refundedCents, refundByHandCents, runs, refundIds, unpaidCents: remaining };
}
