import { addBusinessDays, billingPeriodFor, businessDateKey, businessDaysBetween } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing/money";

/**
 * Pickup and delivery billing rules (owner decisions IN-24 / IN-26 / IN-27,
 * 2026-10-03). Pure: no database, no Stripe. Every number here comes from the
 * agreement's own frozen prices and from the owner's settings, never from a
 * constant in code.
 *
 * Day counting is done on Colorado calendar dates (never on raw timestamps),
 * so a pickup at 11:30 pm on the 14th is a pickup on the 14th.
 *
 * The three rules:
 *   1. Late return    — an item kept past the agreement's end date is charged a
 *                       daily rate for each day past that date.
 *   2. Late delivery  — an item that was not delivered on the visit that started
 *                       billing is still billed with the whole agreement; when it
 *                       arrives the customer is credited, by the day, for the days
 *                       it was missing. Never delivered and taken off the
 *                       agreement: everything billed for it is credited.
 *   3. Pickup day     — when the owner's switch is ON (recommended), the day an
 *                       item is picked up or returned is never charged: the last
 *                       charged day is the day before.
 */

/** Recorded on an ApplianceAssignment when an item is taken off the agreement because it never arrived. */
export const NEVER_DELIVERED_UNASSIGN_REASON = "Never delivered";
/** CustomerCredit.sourceType for a late-delivery or never-delivered credit (sourceId = the PendingDelivery id). */
export const LATE_DELIVERY_CREDIT_SOURCE = "LATE_DELIVERY";

export type LateReturnRateMode = "MONTHLY_DIV_30" | "FIXED";
export type LateDeliveryProrationBasis = "MONTHLY_DIV_30" | "ACTUAL_DAYS_IN_MONTH";

export type PickupBillingSettings = {
  lateReturnRateMode: LateReturnRateMode;
  lateReturnFixedDailyCents: number;
  lateDeliveryProrationBasis: LateDeliveryProrationBasis;
  pickupDayNotBilled: boolean;
};

/** The recommended starting values, as shown by "Restore recommended values" on the settings screen. */
export const RECOMMENDED_PICKUP_BILLING: PickupBillingSettings = {
  lateReturnRateMode: "MONTHLY_DIV_30",
  lateReturnFixedDailyCents: 0,
  lateDeliveryProrationBasis: "MONTHLY_DIV_30",
  pickupDayNotBilled: true,
};

export function isLateReturnRateMode(value: unknown): value is LateReturnRateMode {
  return value === "MONTHLY_DIV_30" || value === "FIXED";
}

export function isLateDeliveryProrationBasis(value: unknown): value is LateDeliveryProrationBasis {
  return value === "MONTHLY_DIV_30" || value === "ACTUAL_DAYS_IN_MONTH";
}

/** Read the settings row defensively: an unknown stored value falls back to the recommended one. */
export function pickupBillingSettingsFrom(row: {
  lateReturnRateMode?: string | null;
  lateReturnFixedDailyCents?: number | null;
  lateDeliveryProrationBasis?: string | null;
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
    lateDeliveryProrationBasis: isLateDeliveryProrationBasis(row.lateDeliveryProrationBasis)
      ? row.lateDeliveryProrationBasis
      : RECOMMENDED_PICKUP_BILLING.lateDeliveryProrationBasis,
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

export type LateDeliveryCredit = {
  /** Days the item was missing: the original delivery date through the day before it arrived. Zero means no credit. */
  days: number;
  /** Days in the billing period that contains the original delivery date (28–31). */
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
 * Rule 2. The whole agreement was billed from `originalDeliveryDate`, but this
 * item only arrived on `actualDeliveryDate`. Credit every Colorado day from the
 * original date through the day BEFORE the actual delivery (the arrival day is
 * a day the customer had it). `period` is the anniversary billing period that
 * contains the original date (the shape `billingPeriodFor` returns); its length
 * is the divisor when the owner chose "actual days in that month".
 * `maxCreditCents` is what was actually billed for the item so far: the credit
 * never exceeds it.
 */
export function calculateLateDeliveryCredit(input: {
  itemLabel: string;
  itemMonthlyPriceCents: number;
  originalDeliveryDate: Date;
  actualDeliveryDate: Date;
  period: { start: Date; end: Date };
  /**
   * The agreement's billing anchor. With "actual days in that month", a delay
   * that crosses an anniversary is split at each billing-period boundary and
   * every piece is divided by its own period's length. Without it the whole
   * delay uses `period` (only correct when the delay stays inside one period).
   */
  billingAnchor?: Date;
  maxCreditCents: number;
  settings: Pick<PickupBillingSettings, "lateDeliveryProrationBasis">;
}): LateDeliveryCredit {
  wholeCents(input.itemMonthlyPriceCents, "Item price");
  wholeCents(input.maxCreditCents, "Billed amount");
  const periodDays = businessDaysBetween(input.period.start, input.period.end);
  if (periodDays < 1) throw new Error("The billing period must be at least one day long.");

  const days = Math.max(0, businessDaysBetween(input.originalDeliveryDate, input.actualDeliveryDate));
  const actual = input.settings.lateDeliveryProrationBasis === "ACTUAL_DAYS_IN_MONTH";
  const basisDays = actual ? periodDays : 30;
  const dailyRateCents = Math.round(input.itemMonthlyPriceCents / basisDays);
  let rawCents = proratedCents(input.itemMonthlyPriceCents, days, basisDays);
  let split = false;
  if (actual && input.billingAnchor && days > 0) {
    rawCents = 0;
    let cursor = input.originalDeliveryDate;
    let guard = 0;
    while (businessDaysBetween(cursor, input.actualDeliveryDate) > 0 && guard++ < 600) {
      const piece = billingPeriodContaining(input.billingAnchor, cursor);
      const pieceEnd = businessDaysBetween(piece.end, input.actualDeliveryDate) < 0 ? input.actualDeliveryDate : piece.end;
      rawCents += proratedCents(
        input.itemMonthlyPriceCents,
        businessDaysBetween(cursor, pieceEnd),
        businessDaysBetween(piece.start, piece.end),
      );
      if (pieceEnd !== input.actualDeliveryDate) split = true;
      cursor = pieceEnd;
    }
  }
  const amountCents = Math.min(input.maxCreditCents, rawCents);

  return {
    days,
    periodDays,
    dailyRateCents,
    amountCents: days === 0 ? 0 : amountCents,
    basis: actual
      ? split
        ? `monthly price ${formatCents(input.itemMonthlyPriceCents)} ÷ the actual days in each billing month the item was missing`
        : `monthly price ${formatCents(input.itemMonthlyPriceCents)} ÷ ${periodDays} days in that billing month`
      : `monthly price ${formatCents(input.itemMonthlyPriceCents)} ÷ 30 per day`,
    description: `Credit – ${input.itemLabel} delivered late – ${days} ${days === 1 ? "day" : "days"}`,
    firstCreditedDayKey: days > 0 ? businessDateKey(input.originalDeliveryDate) : null,
    lastCreditedDayKey: days > 0 ? businessDateKey(addBusinessDays(input.actualDeliveryDate, -1)) : null,
  };
}

/**
 * Rule 2, never delivered. The item is taken off the agreement without ever
 * arriving: everything billed for it is credited — one month's price for each
 * billing period that has started since the original delivery date.
 */
export function calculateNeverDeliveredCredit(input: {
  itemLabel: string;
  itemMonthlyPriceCents: number;
  periodsBilled: number;
}): { months: number; amountCents: number; description: string } {
  wholeCents(input.itemMonthlyPriceCents, "Item price");
  if (!Number.isInteger(input.periodsBilled) || input.periodsBilled < 0) {
    throw new Error("Billed periods must be a whole number, zero or more.");
  }
  const months = input.periodsBilled;
  return {
    months,
    amountCents: input.itemMonthlyPriceCents * months,
    description: `Credit – ${input.itemLabel} never delivered – ${months} ${months === 1 ? "month" : "months"} billed`,
  };
}

/**
 * How many anniversary billing periods have started on or before `asOf`, for
 * an agreement whose billing anchor is `anchor` (0 when billing has not
 * started by then). This is how many months the item has been billed for.
 */
export function periodsBilledThrough(anchor: Date, asOf: Date): number {
  if (businessDaysBetween(anchor, asOf) < 0) return 0;
  return billingPeriodContaining(anchor, asOf).index + 1;
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
