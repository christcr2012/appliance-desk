/**
 * Prepaid-term discount — pure, no database import (see
 * src/domains/pricing/money.ts's comment for why that separation matters
 * for client bundles). Encodes the business rule Chris asked for directly:
 *
 * "i need 6 months paid in advance to get a $5/month discount and 1 year
 * paid in advance to receive $10 per month discount for sets, and half the
 * discount for single units, and these discounts also need to be
 * adjustable by the owner, it doesnt need to be preset to those amounts,
 * the detailed amount is to show you my intent."
 *
 * Two things Chris confirmed explicitly (see docs/DECISIONS.md's dated
 * entry) rather than being guessed:
 * - The discount is earned by signing a 6- or 12-month TERM (not by a
 *   separate lump-sum payment event, which Stripe billing — Phase 6B —
 *   doesn't exist yet to detect).
 * - A "set" means 2+ appliances on the same rental line (e.g. a
 *   washer+dryer pair); a single appliance on its own always gets the
 *   single-unit rate, even if that customer has other lines too.
 *
 * The four dollar amounts are independent, owner-adjustable
 * BusinessSettings values (see docs/BUSINESS-RULES.md's Pricing section)
 * — never derived from one another (never "single = set ÷ 2" in code),
 * per Chris's explicit instruction that these aren't locked to any ratio.
 */

export type PrepayDiscountSettings = {
  sixMonthPrepayDiscountSetCents: number;
  sixMonthPrepayDiscountSingleCents: number;
  twelveMonthPrepayDiscountSetCents: number;
  twelveMonthPrepayDiscountSingleCents: number;
};

/** A rental line's discount depends only on the agreement's term and
 * whether this particular line is a "set" (2+ appliances) — never on the
 * appliance's type/price, and never a fraction of the other three
 * settings. Month-to-month (termMonths null, or any value besides 6/12)
 * never gets a discount. */
export function calculatePrepayDiscountCentsPerMonth(
  termMonths: number | null,
  applianceCountOnLine: number,
  settings: PrepayDiscountSettings,
): number {
  const isSet = applianceCountOnLine >= 2;

  if (termMonths === 6) {
    return isSet
      ? settings.sixMonthPrepayDiscountSetCents
      : settings.sixMonthPrepayDiscountSingleCents;
  }
  if (termMonths === 12) {
    return isSet
      ? settings.twelveMonthPrepayDiscountSetCents
      : settings.twelveMonthPrepayDiscountSingleCents;
  }
  return 0;
}

/**
 * The separate "first month free" bonus Chris added when confirming the
 * design: "for advance payment on a 1 year lease, we will do a free month
 * as well." This is NOT the same thing as the recurring per-month discount
 * above — it only applies when a 12-month customer pays the full term in
 * one lump sum up front, a fact Chris records himself at agreement
 * creation (RentalAgreement.paidInFullInAdvance), since there's no
 * automated billing yet (Phase 6B) to detect an actual lump-sum payment.
 * Independently owner-toggleable (BusinessSettings.
 * twelveMonthPrepayFreeMonthEnabled) — Chris can turn this bonus off
 * without touching the recurring discount amounts.
 */
export function isFreeMonthEarned(
  termMonths: number | null,
  paidInFullInAdvance: boolean,
  twelveMonthPrepayFreeMonthEnabled: boolean,
): boolean {
  return termMonths === 12 && paidInFullInAdvance && twelveMonthPrepayFreeMonthEnabled;
}
