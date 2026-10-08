import type { InvoiceLineItemKind } from "@prisma/client";

/**
 * The few groups the owner thinks in when reading statements and reports.
 * Pure: no database. Every invoice line kind maps to exactly one group, and
 * the compiler fails if a new kind is added without choosing its group.
 *
 * ADJUSTMENT is its own group (it can be positive or negative and is not a
 * fee or a discount); REFUND never appears on an invoice line — refunds are
 * separate records — but statements use the same group names for them.
 */
export type LedgerCategory =
  | "RENT"
  | "FEES"
  | "DEPOSIT"
  | "TAX"
  | "RETAIL_DELIVERY_FEE"
  | "LATE_FEE"
  | "DISCOUNT"
  | "CREDIT"
  | "ADJUSTMENT"
  | "REFUND";

const CATEGORY_BY_KIND: Record<InvoiceLineItemKind, LedgerCategory> = {
  RENTAL: "RENT",
  DELIVERY_FEE: "FEES",
  INSTALLATION_FEE: "FEES",
  REMOVAL_FEE: "FEES",
  DAMAGE_WAIVER: "FEES",
  DEPOSIT: "DEPOSIT",
  TAX: "TAX",
  // Separate statutory remittance liability, never sales-tax revenue or delivery-service income.
  RETAIL_DELIVERY_FEE: "RETAIL_DELIVERY_FEE",
  LATE_FEE: "LATE_FEE",
  PREPAY_DISCOUNT: "DISCOUNT",
  CREDIT: "CREDIT",
  ADJUSTMENT: "ADJUSTMENT",
  EARLY_TERMINATION_FEE: "FEES",
  // Extra days of rent after the agreed end date: rent, not a payment penalty.
  LATE_RETURN: "RENT",
  // A waiver of those extra days (our delay): negative rent.
  LATE_RETURN_WAIVER: "RENT",
};

export function categorizeLine(kind: InvoiceLineItemKind): LedgerCategory {
  const category = CATEGORY_BY_KIND[kind];
  if (!category) throw new Error(`Unknown invoice line kind: ${String(kind)}`);
  return category;
}

/** Owner-facing names for each group. */
export const LEDGER_CATEGORY_LABELS: Record<LedgerCategory, string> = {
  RENT: "Rent",
  FEES: "Fees (delivery, installation, removal, damage waiver)",
  DEPOSIT: "Deposit",
  TAX: "Sales tax",
  RETAIL_DELIVERY_FEE: "Colorado retail delivery fee",
  LATE_FEE: "Late fees",
  DISCOUNT: "Discounts",
  CREDIT: "Credits applied",
  ADJUSTMENT: "Adjustments",
  REFUND: "Refunds",
};

/** Sum signed line amounts by group; groups with no lines are omitted. */
export function totalsByCategory(
  lines: ReadonlyArray<{ kind: InvoiceLineItemKind; amountCents: number }>,
): Partial<Record<LedgerCategory, number>> {
  const totals: Partial<Record<LedgerCategory, number>> = {};
  for (const line of lines) {
    const category = categorizeLine(line.kind);
    totals[category] = (totals[category] ?? 0) + line.amountCents;
  }
  return totals;
}
