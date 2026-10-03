import { addBusinessDays, billingPeriodFor, businessDateKey, businessDaysBetween } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing/money";

/**
 * Pickup and return billing rules (owner decisions IN-24 / IN-26 / IN-27,
 * 2026-10-03). Pure: no database, no Stripe. Every number here comes from the
 * agreement's own frozen prices and from the owner's settings, never from a
 * constant in code.
 *
 * Day counting is done on Colorado calendar dates (never on raw timestamps),
 * so a return at 11:30 pm on the 14th is a return on the 14th.
 *
 * The three rules:
 *   1. Late return   — an item kept past the agreement's end date is charged a
 *                      daily rate for each day past that date.
 *   2. Early return  — an item given back while the rest of the agreement
 *                      continues earns a credit for the days of the already
 *                      billed period it was not in the customer's hands.
 *   3. Pickup day    — when the owner's switch is ON (recommended), the day an
 *                      item is picked up or returned is never charged: the last
 *                      charged day is the day before.
 */

/** Recorded on an ApplianceAssignment when a partial pickup releases the appliance early. */
export const EARLY_RETURN_UNASSIGN_REASON = "Returned early";
/** CustomerCredit.sourceType for an early-return credit (sourceId = "<jobId>:<applianceId>"). */
export const EARLY_RETURN_CREDIT_SOURCE = "EARLY_RETURN";

export type LateReturnRateMode = "MONTHLY_DIV_30" | "FIXED";
export type EarlyReturnProrationBasis = "MONTHLY_DIV_30" | "ACTUAL_DAYS_IN_MONTH";

export type PickupBillingSettings = {
  lateReturnRateMode: LateReturnRateMode;
  lateReturnFixedDailyCents: number;
  earlyReturnProrationBasis: EarlyReturnProrationBasis;
  pickupDayNotBilled: boolean;
};

/** The recommended starting values, as shown by "Restore recommended values" on the settings screen. */
export const RECOMMENDED_PICKUP_BILLING: PickupBillingSettings = {
  lateReturnRateMode: "MONTHLY_DIV_30",
  lateReturnFixedDailyCents: 0,
  earlyReturnProrationBasis: "MONTHLY_DIV_30",
  pickupDayNotBilled: true,
};

export function isLateReturnRateMode(value: unknown): value is LateReturnRateMode {
  return value === "MONTHLY_DIV_30" || value === "FIXED";
}

export function isEarlyReturnProrationBasis(value: unknown): value is EarlyReturnProrationBasis {
  return value === "MONTHLY_DIV_30" || value === "ACTUAL_DAYS_IN_MONTH";
}

/** Read the settings row defensively: an unknown stored value falls back to the recommended one. */
export function pickupBillingSettingsFrom(row: {
  lateReturnRateMode?: string | null;
  lateReturnFixedDailyCents?: number | null;
  earlyReturnProrationBasis?: string | null;
  pickupDayNotBilled?: boolean | null;
}): PickupBillingSettings {
  return {
    lateReturnRateMode: isLateReturnRateMode(row.lateReturnRateMode)
      ? row.lateReturnRateMode
      : RECOMMENDED_PICKUP_BILLING.lateReturnRateMode,
    lateReturnFixedDailyCents:
      Number.isInteger(row.lateReturnFixedDailyCents) && (row.lateReturnFixedDailyCents ?? 0) >= 0
        ? (row.lateReturnFixedDailyCents as number)
        : RECOMMENDED_PICKUP_BILLING.lateReturnFixedDailyCents,
    earlyReturnProrationBasis: isEarlyReturnProrationBasis(row.earlyReturnProrationBasis)
      ? row.earlyReturnProrationBasis
      : RECOMMENDED_PICKUP_BILLING.earlyReturnProrationBasis,
    pickupDayNotBilled:
      typeof row.pickupDayNotBilled === "boolean"
        ? row.pickupDayNotBilled
        : RECOMMENDED_PICKUP_BILLING.pickupDayNotBilled,
  };
}

function wholeCents(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a whole number of cents, zero or more.`);
  }
}

/**
 * Rule 3. The last day a customer is charged for an item that is picked up or
 * returned on `pickupDate`: the day before when the switch is on, the pickup
 * day itself when it is off. Returned as a Colorado date key (YYYY-MM-DD).
 */
export function lastChargeableDayKey(pickupDate: Date, settings: Pick<PickupBillingSettings, "pickupDayNotBilled">): string {
  return settings.pickupDayNotBilled
    ? businessDateKey(addBusinessDays(pickupDate, -1))
    : businessDateKey(pickupDate);
}

/**
 * What one item costs per month when several items share one rental line
 * (a washer + dryer "set" has one price for the pair). The set price is split
 * evenly, to the cent, with any leftover cent on the first item so the parts
 * always add back up to the line price. A line with one item is just its price.
 */
export function itemMonthlyPriceCents(lineMonthlyPriceCents: number, itemsOnLine: number, itemIndex = 0): number {
  wholeCents(lineMonthlyPriceCents, "Line price");
  if (!Number.isInteger(itemsOnLine) || itemsOnLine < 1) {
    throw new Error("A rental line must have at least one item.");
  }
  if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= itemsOnLine) {
    throw new Error("Item position is outside the line.");
  }
  const share = Math.floor(lineMonthlyPriceCents / itemsOnLine);
  const leftover = lineMonthlyPriceCents - share * itemsOnLine;
  return share + (itemIndex < leftover ? 1 : 0);
}

/** `monthlyPriceCents × days ÷ basisDays`, rounded to the cent once (never per day, so cents don't drift). */
function proratedCents(monthlyPriceCents: number, days: number, basisDays: number): number {
  return Math.round((monthlyPriceCents * days) / basisDays);
}

export type LateReturnCharge = {
  /** Days charged past the end date. Zero means nothing is owed. */
  days: number;
  /** The per-day rate shown to the customer, in cents. */
  dailyRateCents: number;
  /** What is owed for all late days, in cents (before tax). */
  amountCents: number;
  /** Where the rate came from, in plain words, for the audit trail. */
  basis: string;
  /** Exactly what the customer sees on the bill. */
  description: string;
  /** First and last charged day (Colorado dates), or null when nothing is charged. */
  firstChargedDayKey: string | null;
  lastChargedDayKey: string | null;
};

/**
 * Rule 1. Days are counted from the day after the agreement's end date (the
 * end date itself was already paid for) through the last chargeable day
 * (rule 3). An item picked up on or before that is not late.
 */
export function calculateLateReturnCharge(input: {
  itemLabel: string;
  itemMonthlyPriceCents: number;
  /** The agreement's end date: its last paid-for day. */
  agreedEndDate: Date;
  /** When the item was actually picked up or returned. */
  pickupDate: Date;
  settings: PickupBillingSettings;
}): LateReturnCharge {
  wholeCents(input.itemMonthlyPriceCents, "Item price");
  wholeCents(input.settings.lateReturnFixedDailyCents, "Fixed daily late rate");

  const firstLateDay = addBusinessDays(input.agreedEndDate, 1);
  const lastChargedKey = lastChargeableDayKey(input.pickupDate, input.settings);
  const lastCharged = new Date(`${lastChargedKey}T12:00:00Z`);
  // Whole calendar days from the first late day through the last charged day, inclusive.
  const days = Math.max(0, businessDaysBetween(firstLateDay, lastCharged) + 1);

  const fixed = input.settings.lateReturnRateMode === "FIXED";
  const dailyRateCents = fixed
    ? input.settings.lateReturnFixedDailyCents
    : Math.round(input.itemMonthlyPriceCents / 30);
  const amountCents = fixed
    ? input.settings.lateReturnFixedDailyCents * days
    : proratedCents(input.itemMonthlyPriceCents, days, 30);

  return {
    days,
    dailyRateCents,
    amountCents: days === 0 ? 0 : amountCents,
    basis: fixed
      ? `fixed rate of ${formatCents(input.settings.lateReturnFixedDailyCents)} per day`
      : `monthly price ${formatCents(input.itemMonthlyPriceCents)} ÷ 30 per day`,
    description: `Late return – ${input.itemLabel} – ${days} ${days === 1 ? "day" : "days"}`,
    firstChargedDayKey: days > 0 ? businessDateKey(firstLateDay) : null,
    lastChargedDayKey: days > 0 ? lastChargedKey : null,
  };
}

export type EarlyReturnCredit = {
  /** Days of the billed period the item was not in the customer's hands. Zero means no credit. */
  days: number;
  /** How many days the billed period runs (28–31 for a monthly period). */
  periodDays: number;
  /** The per-day credit, in cents. */
  dailyRateCents: number;
  /** The credit as a positive number of cents. Shown on the bill as a negative line. */
  amountCents: number;
  basis: string;
  description: string;
  firstCreditedDayKey: string | null;
  lastCreditedDayKey: string | null;
};

/**
 * Rule 2. The billed period is [periodStart, periodEnd): periodStart is the
 * Colorado midnight that opened it and periodEnd the midnight that opens the
 * next one (the shape `billingPeriodFor` returns). The credit covers every day
 * of that period from the first day NOT charged (the return day itself under
 * rule 3, otherwise the day after) through the period's last day.
 */
export function calculateEarlyReturnCredit(input: {
  itemLabel: string;
  itemMonthlyPriceCents: number;
  periodStart: Date;
  periodEnd: Date;
  returnDate: Date;
  settings: PickupBillingSettings;
}): EarlyReturnCredit {
  wholeCents(input.itemMonthlyPriceCents, "Item price");
  const periodDays = businessDaysBetween(input.periodStart, input.periodEnd);
  if (periodDays < 1) throw new Error("The billed period must be at least one day long.");

  const lastPeriodDay = addBusinessDays(input.periodEnd, -1);
  const lastChargedKey = lastChargeableDayKey(input.returnDate, input.settings);
  const firstCredited = addBusinessDays(new Date(`${lastChargedKey}T12:00:00Z`), 1);
  // A return before the period began is capped at the period's first day; a
  // return after it ended earns nothing from this period.
  const firstCreditedClamped =
    businessDaysBetween(input.periodStart, firstCredited) < 0 ? input.periodStart : firstCredited;
  const days = Math.max(0, businessDaysBetween(firstCreditedClamped, lastPeriodDay) + 1);

  const actual = input.settings.earlyReturnProrationBasis === "ACTUAL_DAYS_IN_MONTH";
  const basisDays = actual ? periodDays : 30;
  const dailyRateCents = Math.round(input.itemMonthlyPriceCents / basisDays);
  // Never credit more than was charged for the item in that period.
  const amountCents = Math.min(input.itemMonthlyPriceCents, proratedCents(input.itemMonthlyPriceCents, days, basisDays));

  return {
    days,
    periodDays,
    dailyRateCents,
    amountCents: days === 0 ? 0 : amountCents,
    basis: actual
      ? `monthly price ${formatCents(input.itemMonthlyPriceCents)} ÷ ${periodDays} days in that billing month`
      : `monthly price ${formatCents(input.itemMonthlyPriceCents)} ÷ 30 per day`,
    description: `Credit – ${input.itemLabel} returned early – ${days} ${days === 1 ? "day" : "days"}`,
    firstCreditedDayKey: days > 0 ? businessDateKey(firstCreditedClamped) : null,
    lastCreditedDayKey: days > 0 ? businessDateKey(lastPeriodDay) : null,
  };
}

/** The anniversary billing period (from `billingPeriodFor`) that contains `date`. */
export function billingPeriodContaining(anchor: Date, date: Date): { start: Date; end: Date; index: number } {
  const [ay, am] = businessDateKey(anchor).split("-").map(Number);
  const [dy, dm] = businessDateKey(date).split("-").map(Number);
  let index = Math.max(0, (dy - ay) * 12 + (dm - am));
  // The month difference can be one off either way around the anchor day.
  for (let attempt = 0; attempt < 3; attempt++) {
    const period = billingPeriodFor(anchor, index);
    if (businessDaysBetween(period.start, date) < 0) {
      if (index === 0) return { ...period, index };
      index -= 1;
      continue;
    }
    if (businessDaysBetween(date, period.end) <= 0) {
      index += 1;
      continue;
    }
    return { ...period, index };
  }
  const period = billingPeriodFor(anchor, index);
  return { ...period, index };
}
