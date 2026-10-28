export const TAX_CHARGE_CATEGORIES = [
  "RENTAL",
  "ADMINISTRATIVE_SETUP",
  "LATE_RETURN",
  "DELIVERY",
  "INSTALLATION",
  "REMOVAL",
  "DAMAGE_WAIVER",
  "EARLY_TERMINATION",
  "LATE_PAYMENT_FEE",
  "OTHER_CHARGE",
  "MERCHANDISE",
  "USED_APPLIANCE_SALE",
  "HAUL_AWAY",
] as const;

export type TaxChargeCategory = (typeof TAX_CHARGE_CATEGORIES)[number];

/** FEETAX-1: the services a customer can decline and do themselves — the lines the optional-and-separate rule applies to. */
export const SERVICE_LINE_CATEGORIES = ["DELIVERY", "INSTALLATION", "REMOVAL", "HAUL_AWAY"] as const;

/** The categories every rental business must decide before billing. Selling items adds its own two (below). */
export const RENTAL_TAX_CATEGORIES = TAX_CHARGE_CATEGORIES.filter(
  (category) => category !== "MERCHANDISE" && category !== "USED_APPLIANCE_SALE",
);
/** Decided only by owners who sell items; a sale of that kind is refused until its answer is recorded. */
export const SALE_TAX_CATEGORIES = ["MERCHANDISE", "USED_APPLIANCE_SALE"] as const;

export type InvoiceLineItemKind =
  | "ADMIN_SETUP_FEE"
  | "RENTAL"
  | "RETAIL_DELIVERY_FEE"
  | "DELIVERY_FEE"
  | "INSTALLATION_FEE"
  | "REMOVAL_FEE"
  | "HAUL_AWAY_FEE"
  | "DAMAGE_WAIVER"
  | "DEPOSIT"
  | "TAX"
  | "LATE_FEE"
  | "PREPAY_DISCOUNT"
  | "CREDIT"
  | "ADJUSTMENT"
  | "EARLY_TERMINATION_FEE"
  | "LATE_RETURN"
  | "LATE_RETURN_WAIVER"
  | "MERCHANDISE"
  | "USED_APPLIANCE";

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
    case "ADMIN_SETUP_FEE":
      return "ADMINISTRATIVE_SETUP";
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
    case "HAUL_AWAY_FEE":
      return "HAUL_AWAY";
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
    case "MERCHANDISE":
      return "MERCHANDISE";
    case "USED_APPLIANCE":
      return "USED_APPLIANCE_SALE";
    case "CREDIT":
    case "RETAIL_DELIVERY_FEE":
    case "DEPOSIT":
    case "TAX":
      return "NOT_TAXABLE";
  }
}
