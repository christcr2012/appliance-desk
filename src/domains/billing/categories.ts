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
 * Real cash basis for reporting: Receipt receivedOn inside the period minus
 * Refund createdAt inside the same period. Receipt.amountCents is used whole,
 * so overpayments are included even when some cash is not allocated yet.
 */
export async function collectedBetween(
  customerId: string | null,
  from: Date,
  to: Date,
): Promise<CollectedSummary> {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
    throw new Error("Collection period must have valid increasing boundaries.");
  }

  const [receipts, refunds] = await prisma.$transaction(async (tx) =>
    Promise.all([
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
        select: { amountCents: true },
      }),
    ]),
  );

  const byMethod: Record<string, number> = {};
  let grossCents = 0;
  for (const receipt of receipts) {
    grossCents += receipt.amountCents;
    const method = receipt.method.trim() || "other";
    byMethod[method] = (byMethod[method] ?? 0) + receipt.amountCents;
  }
  const refundedCents = refunds.reduce((sum, refund) => sum + refund.amountCents, 0);

  return {
    grossCents,
    refundedCents,
    netCents: grossCents - refundedCents,
    byMethod,
  };
}
