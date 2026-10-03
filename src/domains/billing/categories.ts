import type { InvoiceLineItemKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type LedgerCategory =
  | "RENT"
  | "FEES"
  | "DEPOSIT"
  | "TAX"
  | "LATE_FEE"
  | "DISCOUNT"
  | "CREDIT"
  | "REFUND";

export function categorizeLine(kind: InvoiceLineItemKind): LedgerCategory {
  switch (kind) {
    case "RENTAL":
      return "RENT";
    case "DEPOSIT":
      return "DEPOSIT";
    case "TAX":
      return "TAX";
    case "LATE_FEE":
      return "LATE_FEE";
    case "PREPAY_DISCOUNT":
      return "DISCOUNT";
    case "CREDIT":
      return "CREDIT";
    case "DELIVERY_FEE":
    case "INSTALLATION_FEE":
    case "REMOVAL_FEE":
    case "DAMAGE_WAIVER":
    case "ADJUSTMENT":
      return "FEES";
  }
}

export type CollectedSummary = {
  grossCents: number;
  refundedCents: number;
  netCents: number;
  byMethod: Record<string, number>;
};

/**
 * Real cash basis for reporting: whole Receipt cash inside the period minus
 * cash actually returned inside the same period. Refund decisions converted to
 * CustomerCredit are deliberately excluded because no cash left the business;
 * refunded deposits are included because they are real returned cash even
 * though their lifecycle is recorded on Deposit instead of Refund.
 */
export async function collectedBetween(
  customerId: string | null,
  from: Date,
  to: Date,
): Promise<CollectedSummary> {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
    throw new Error("Collection period must have valid increasing boundaries.");
  }

  const [receipts, refunds, depositRefunds] = await prisma.$transaction(
    async (tx) => {
      const [receiptRows, refundRows, depositRows] = await Promise.all([
        tx.receipt.findMany({
          where: {
            ...(customerId ? { customerId } : {}),
            receivedOn: { gte: from, lt: to },
          },
          select: { amountCents: true, method: true },
        }),
        tx.refund.findMany({
          where: {
            ...(customerId ? { invoice: { customerId } } : {}),
            createdAt: { gte: from, lt: to },
          },
          select: { id: true, amountCents: true },
        }),
        tx.deposit.findMany({
          where: {
            refundedAt: { gte: from, lt: to },
            ...(customerId ? { agreement: { customerId } } : {}),
          },
          select: { refundedAmountCents: true },
        }),
      ]);

      const refundIds = refundRows.map((refund) => refund.id);
      const creditRefunds = refundIds.length
        ? await tx.customerCredit.findMany({
            where: {
              sourceType: "REFUND_TO_CREDIT",
              sourceId: { in: refundIds },
            },
            select: { sourceId: true },
          })
        : [];
      const creditRefundIds = new Set(
        creditRefunds.flatMap((credit) => (credit.sourceId ? [credit.sourceId] : [])),
      );

      return [
        receiptRows,
        refundRows.filter((refund) => !creditRefundIds.has(refund.id)),
        depositRows,
      ] as const;
    },
  );

  const byMethod: Record<string, number> = {};
  let grossCents = 0;
  for (const receipt of receipts) {
    grossCents += receipt.amountCents;
    const method = receipt.method.trim() || "other";
    byMethod[method] = (byMethod[method] ?? 0) + receipt.amountCents;
  }
  const invoiceRefundCents = refunds.reduce(
    (sum, refund) => sum + refund.amountCents,
    0,
  );
  const depositRefundCents = depositRefunds.reduce(
    (sum, deposit) => sum + (deposit.refundedAmountCents ?? 0),
    0,
  );
  const refundedCents = invoiceRefundCents + depositRefundCents;

  return {
    grossCents,
    refundedCents,
    netCents: grossCents - refundedCents,
    byMethod,
  };
}
