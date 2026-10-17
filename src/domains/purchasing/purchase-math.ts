import { allocateAcrossLines } from "@/domains/tax/allocate";

/**
 * W-14 — the money arithmetic of "Record a purchase". Pure and free of database imports so the
 * screen can show the exact split before saving and the server can recompute and enforce it.
 * All amounts are integer cents.
 */

export type TaxSplitBasis = "BY_PRICE" | "EQUAL" | "NONE";

export type PurchaseReconciliation = {
  subtotalCents: number;
  sellerTaxCents: number;
  otherChargesCents: number;
  receiptTotalCents: number;
  /** One share of the seller tax per appliance row, in row order; always sums to sellerTaxCents. */
  taxShares: number[];
  basis: TaxSplitBasis;
  problems: string[];
};

function requireCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error(`${label} must be a whole-cent amount from $0.00 up to $21,474,836.47.`);
  }
}

/**
 * Split the tax printed on the receipt across the appliances by price (largest remainder, so the
 * pieces add up to the cent). Equal shares only when every price is zero, as the receipt then gives
 * no better basis.
 */
export function splitSellerTax(
  pricesCents: readonly number[],
  sellerTaxCents: number,
): { shares: number[]; basis: TaxSplitBasis } {
  requireCents(sellerTaxCents, "Seller tax");
  pricesCents.forEach((price) => requireCents(price, "A price"));
  if (pricesCents.length === 0) {
    if (sellerTaxCents !== 0) throw new Error("Add at least one appliance before splitting tax.");
    return { shares: [], basis: "NONE" };
  }
  if (sellerTaxCents === 0) return { shares: pricesCents.map(() => 0), basis: "NONE" };
  const total = pricesCents.reduce((sum, price) => sum + price, 0);
  if (total === 0) {
    return { shares: allocateAcrossLines(sellerTaxCents, pricesCents.map(() => 1)), basis: "EQUAL" };
  }
  return { shares: allocateAcrossLines(sellerTaxCents, pricesCents), basis: "BY_PRICE" };
}

/**
 * Prove the purchase adds up: subtotal (sum of the prices) + tax + other charges is the receipt total,
 * and, when the person typed the receipt's own subtotal or total, they must agree to the cent.
 * `problems` is plain-English text safe to show; an empty list means the purchase reconciles.
 */
export function reconcilePurchase(input: {
  pricesCents: readonly number[];
  sellerTaxCents: number;
  otherChargesCents: number;
  receiptSubtotalCents?: number | null;
  receiptTotalCents?: number | null;
}): PurchaseReconciliation {
  requireCents(input.otherChargesCents, "Delivery or other charges");
  const split = splitSellerTax(input.pricesCents, input.sellerTaxCents);
  const subtotalCents = input.pricesCents.reduce((sum, price) => sum + price, 0);
  requireCents(subtotalCents, "The subtotal");
  const receiptTotalCents = subtotalCents + input.sellerTaxCents + input.otherChargesCents;
  const problems: string[] = [];
  if (input.pricesCents.length === 0) problems.push("Add at least one appliance.");
  if (input.receiptSubtotalCents !== undefined && input.receiptSubtotalCents !== null) {
    requireCents(input.receiptSubtotalCents, "The receipt subtotal");
    if (input.receiptSubtotalCents !== subtotalCents) {
      problems.push(
        `The appliance prices add up to ${dollars(subtotalCents)}, but the receipt subtotal is ${dollars(input.receiptSubtotalCents)}.`,
      );
    }
  }
  if (input.receiptTotalCents !== undefined && input.receiptTotalCents !== null) {
    requireCents(input.receiptTotalCents, "The receipt total");
    if (input.receiptTotalCents !== receiptTotalCents) {
      problems.push(
        `Prices, tax and other charges add up to ${dollars(receiptTotalCents)}, but the receipt total is ${dollars(input.receiptTotalCents)}.`,
      );
    }
  }
  return {
    subtotalCents,
    sellerTaxCents: input.sellerTaxCents,
    otherChargesCents: input.otherChargesCents,
    receiptTotalCents,
    taxShares: split.shares,
    basis: split.basis,
    problems,
  };
}

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
