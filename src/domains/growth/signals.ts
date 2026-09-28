// ---------------------------------------------------------------------------
// Growth signals — pure rules for the rest of /desk/growth (fleet
// utilization flags, price-review reminders, lead win-back nudges). Same
// split as churn.ts: no database import here, so these are directly
// unit-testable; src/domains/growth/index.ts is the DB-fetching wrapper.
// See docs/reviews/2026-09-27-business-growth-ideas.md ideas #3, #4, #7,
// #8 and docs/BUSINESS-RULES.md's "Growth signals" section for what each
// one means and why these particular thresholds.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30;

export type UtilizationFlag = "SHORTAGE" | "UNDERUTILIZED" | null;

/** An appliance type sitting at/near fully rented out is a "you're
 * probably losing rentals to no availability" signal (idea #3); one
 * that's mostly sitting idle is the opposite — maybe overpriced or
 * overstocked (idea #4). Simple, explainable cutoffs, not a statistical
 * model — same spirit as lead scoring and the exception inbox's
 * thresholds. */
export const SHORTAGE_UTILIZATION_THRESHOLD = 0.85;
export const UNDERUTILIZED_UTILIZATION_THRESHOLD = 0.3;
/** Below this many units of a type, a utilization flag is mostly noise —
 * one washer being rented is 100% "utilization" and tells Chris nothing
 * useful about whether to buy more. */
export const MIN_UNITS_FOR_UTILIZATION_FLAG = 3;

export function flagUtilization(
  averageUtilizationFraction: number,
  unitCount: number,
): UtilizationFlag {
  if (unitCount < MIN_UNITS_FOR_UTILIZATION_FLAG) {
    return null;
  }
  if (averageUtilizationFraction >= SHORTAGE_UTILIZATION_THRESHOLD) {
    return "SHORTAGE";
  }
  if (averageUtilizationFraction <= UNDERUTILIZED_UTILIZATION_THRESHOLD) {
    return "UNDERUTILIZED";
  }
  return null;
}

/** An ACTIVE agreement whose price was agreed a year or more ago is
 * worth a look — never an automatic change (a price change on an
 * existing customer is relationship-sensitive, idea #8), just a
 * reminder that it hasn't been revisited. Agreement pricing is frozen
 * at signing and never edited in place (docs/BUSINESS-RULES.md), so
 * "how long since the price was set" is simply how long ago the
 * agreement started. */
export const PRICE_REVIEW_MONTHS = 12;

export function isPriceReviewDue(startDate: Date | null, asOf: Date): boolean {
  if (!startDate) {
    return false;
  }
  const months = (asOf.getTime() - startDate.getTime()) / MS_PER_DAY / DAYS_PER_MONTH;
  return months >= PRICE_REVIEW_MONTHS;
}

/** How many days since startDate, for display next to a price-review
 * flag ("signed 14 months ago"). */
export function monthsSince(startDate: Date, asOf: Date): number {
  return Math.floor((asOf.getTime() - startDate.getTime()) / MS_PER_DAY / DAYS_PER_MONTH);
}

/** A NEW/CONTACTED lead that's gone quiet is worth a follow-up; a LOST
 * lead is worth a second look only after enough time that circumstances
 * might genuinely have changed — re-approaching a fresh "no" a week
 * later is just annoying (idea #7). Returns a plain-English reason, or
 * null if this lead isn't due for a nudge yet. */
export const STALE_FOLLOWUP_DAYS = 14;
export const LOST_REVISIT_DAYS = 60;

export function winBackReason(
  status: "NEW" | "CONTACTED" | "LOST",
  updatedAt: Date,
  asOf: Date,
): string | null {
  const days = Math.floor((asOf.getTime() - updatedAt.getTime()) / MS_PER_DAY);
  if (status === "LOST") {
    return days >= LOST_REVISIT_DAYS
      ? `Marked lost ${days} days ago — worth a second look`
      : null;
  }
  return days >= STALE_FOLLOWUP_DAYS ? `No update in ${days} days` : null;
}

/** A customer whose rental has been active and billing cleanly for a
 * while, with nothing currently past due, is a reasonable moment to ask
 * for a review or referral (idea #6) — this only decides who's a
 * reasonable candidate to ask; nothing here sends anything automatically
 * (see docs/BUSINESS-RULES.md's "Growth signals" section for why). */
export const REVIEW_REQUEST_MIN_DAYS_BILLING = 90;

export function isReviewRequestCandidate(
  billingStartedAt: Date | null,
  hasPastDueInvoice: boolean,
  asOf: Date,
): boolean {
  if (!billingStartedAt || hasPastDueInvoice) {
    return false;
  }
  const days = (asOf.getTime() - billingStartedAt.getTime()) / MS_PER_DAY;
  return days >= REVIEW_REQUEST_MIN_DAYS_BILLING;
}
