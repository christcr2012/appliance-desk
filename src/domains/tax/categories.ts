export const TAX_CHARGE_CATEGORIES = [
  "RENTAL",
  "LATE_RETURN",
  "DELIVERY",
  "INSTALLATION",
  "REMOVAL",
  "DAMAGE_WAIVER",
  "EARLY_TERMINATION",
  "LATE_PAYMENT_FEE",
  "OTHER_CHARGE",
] as const;

export type TaxChargeCategory = (typeof TAX_CHARGE_CATEGORIES)[number];

export type InvoiceLineItemKind =
  | "RENTAL"
  | "DELIVERY_FEE"
  | "INSTALLATION_FEE"
  | "REMOVAL_FEE"
  | "DAMAGE_WAIVER"
  | "DEPOSIT"
  | "TAX"
  | "LATE_FEE"
  | "PREPAY_DISCOUNT"
  | "CREDIT"
  | "ADJUSTMENT"
  | "EARLY_TERMINATION_FEE"
  | "LATE_RETURN"
  | "LATE_RETURN_WAIVER";

export type LineTaxCategory =
  | TaxChargeCategory
  | "NOT_TAXABLE"
  | "FOLLOWS_PARENT";

/**
 * Maps persisted invoice-line kinds onto the tax engine's smaller charge
 * vocabulary. This is deliberately pure: it does not infer any taxability
 * answer, jurisdiction or rate.
 */
export function categoryForLineKind(
  kind: InvoiceLineItemKind,
  amountCents: number,
): LineTaxCategory {
  switch (kind) {
    case "RENTAL":
      return "RENTAL";
    case "LATE_RETURN":
    case "LATE_RETURN_WAIVER":
      return "LATE_RETURN";
    case "DELIVERY_FEE":
      return "DELIVERY";
    case "INSTALLATION_FEE":
      return "INSTALLATION";
    case "REMOVAL_FEE":
      return "REMOVAL";
    case "DAMAGE_WAIVER":
      return "DAMAGE_WAIVER";
    case "EARLY_TERMINATION_FEE":
      return "EARLY_TERMINATION";
    case "LATE_FEE":
      return "LATE_PAYMENT_FEE";
    case "PREPAY_DISCOUNT":
      return "FOLLOWS_PARENT";
    case "ADJUSTMENT":
      if (amountCents < 0) return "FOLLOWS_PARENT";
      if (amountCents > 0) return "OTHER_CHARGE";
      return "NOT_TAXABLE";
    case "CREDIT":
    case "DEPOSIT":
    case "TAX":
      return "NOT_TAXABLE";
  }
}
