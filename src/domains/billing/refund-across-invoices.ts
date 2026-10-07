import type { Prisma } from "@prisma/client";
import { prepareInvoiceRefundInTx, type ClaimedRefund } from "./refunds";

export type RefundAcrossRun = { refundId: string; claim: ClaimedRefund; invoiceId: string; amountCents: number };

export async function billedRentalLineChargeCentsInTx(
  tx: Prisma.TransactionClient,
  input: { agreementId: string; rentalLineId: string },
): Promise<number> {
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

  return lines.reduce(
    (sum, line) =>
      sum +
      line.amountCents +
      line.taxLines.reduce((taxSum, taxLine) => taxSum + taxLine.taxCents, 0),
    0,
  );
}

/**
 * Actual historical billed amount for one agreement line. This deliberately
 * reads persisted invoice/tax evidence instead of rebuilding history from the
 * agreement's display-only tax snapshot or today's tax rules.
 */
/**
 * Pay money back to a customer for an agreement: the newest paid invoices first. A Stripe-paid invoice is refunded to
 * the original card or bank through Stripe (the caller runs the returned `runs` after the transaction commits);
 * money paid another way is recorded for the owner to pay back by hand. Whatever was billed but never paid is left
 * over in `unpaidCents` (there is nothing to refund for it). Runs inside the caller's transaction, which must already
 * hold the customer ledger and agreement locks.
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
