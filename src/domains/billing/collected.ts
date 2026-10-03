import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type CollectedSummary = {
  /** Every receipt received in the period, including any unallocated overpayment. */
  grossCents: number;
  /** Cash actually returned to customers (card refunds and recorded manual refunds). */
  refundedCents: number;
  /** Refunds the owner chose to keep as account credit: no cash left the business. */
  refundedToCreditCents: number;
  /** grossCents - refundedCents. Credit refunds are excluded because the money is still held. */
  netCents: number;
  /** Gross receipts by payment method, e.g. { card: 12000, check: 4500 }. */
  byMethod: Record<string, number>;
};

/**
 * What was actually collected between two instants (from inclusive, to
 * exclusive), straight from the ledger: receipts by the day the money was
 * received, minus cash refunds by the day they were recorded. Pass null for
 * customerId to cover the whole business. Callers pick the instants; use the
 * business-day helpers in `@/lib/business-date` so "this month" means
 * Colorado's month.
 */
export async function collectedBetween(
  customerId: string | null,
  from: Date,
  to: Date,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<CollectedSummary> {
  if (!(from < to)) throw new Error("The start of the period must be before its end.");

  const [receipts, refunds] = await Promise.all([
    client.receipt.findMany({
      where: { receivedOn: { gte: from, lt: to }, ...(customerId ? { customerId } : {}) },
      select: { amountCents: true, method: true },
    }),
    client.refund.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        ...(customerId ? { invoice: { customerId } } : {}),
      },
      select: { id: true, amountCents: true },
    }),
  ]);

  const creditRefundIds = refunds.length
    ? new Set(
        (
          await client.customerCredit.findMany({
            where: { sourceType: "REFUND_TO_CREDIT", sourceId: { in: refunds.map((r) => r.id) } },
            select: { sourceId: true },
          })
        ).map((credit) => credit.sourceId),
      )
    : new Set<string | null>();

  const byMethod: Record<string, number> = {};
  let grossCents = 0;
  for (const receipt of receipts) {
    grossCents += receipt.amountCents;
    byMethod[receipt.method] = (byMethod[receipt.method] ?? 0) + receipt.amountCents;
  }

  let refundedCents = 0;
  let refundedToCreditCents = 0;
  for (const refund of refunds) {
    if (creditRefundIds.has(refund.id)) refundedToCreditCents += refund.amountCents;
    else refundedCents += refund.amountCents;
  }

  return {
    grossCents,
    refundedCents,
    refundedToCreditCents,
    netCents: grossCents - refundedCents,
    byMethod,
  };
}
