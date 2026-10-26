// FEE-1: the pure rules for fair late fees (docs/build-specs/engines/LATE-FEES.md). No database, no Stripe, no clock:
// everything is a function of the facts passed in, so every rule is unit-tested. Dates are Colorado calendar days
// ("YYYY-MM-DD" keys); money is whole cents.
import type { LateFeeClass } from "@prisma/client";

/** A bill must be unpaid for MORE than this many days after its due date before a fee can exist (fee on day 11). */
export const LATE_FEE_MIN_GRACE_DAYS = 10;
/** No late fee is ever more than $15 (Chris, 2026-10-25: one rule for every rental). */
export const LATE_FEE_CAP_CENTS = 1500;
/** A fee must be recorded within this many days after the due date, or not at all. */
export const LATE_FEE_WINDOW_DAYS = 30;
/** Autopay: the customer gets the new amount and date at least this many days before it is charged. */
export const AUTOPAY_NOTICE_DAYS = 10;
export const LATE_FEE_NOTICE_DAYS_DEFAULT = 2;
export const LATE_FEE_NOTICE_DAYS_MIN = 1;
export const LATE_FEE_NOTICE_DAYS_MAX = 5;

export function addDaysToKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetweenKeys(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

/** The owner's "days to pay" setting never goes below Colorado's 10 days; an older signed agreement with 5 is lifted to 10. */
export function effectiveGraceDays(snapshotGraceDays: number): number {
  return Math.max(LATE_FEE_MIN_GRACE_DAYS, Number.isFinite(snapshotGraceDays) ? Math.trunc(snapshotGraceDays) : 0);
}

/** First day a fee can exist: the day after the last day to pay (due 1 Oct, 10 days to pay → fee day 12 Oct = day 11). */
export function baseFeeDateKey(dueKey: string, graceDays: number): string {
  return addDaysToKey(dueKey, effectiveGraceDays(graceDays) + 1);
}

/** The warning goes out this many days before the fee day. */
export function noticeDateKey(feeDateKey: string, noticeDays: number): string {
  return addDaysToKey(feeDateKey, -validateNoticeDays(noticeDays));
}

export function validateNoticeDays(value: number): number {
  if (!Number.isInteger(value) || value < LATE_FEE_NOTICE_DAYS_MIN || value > LATE_FEE_NOTICE_DAYS_MAX) {
    throw new Error(`Choose a whole number of days from ${LATE_FEE_NOTICE_DAYS_MIN} to ${LATE_FEE_NOTICE_DAYS_MAX}.`);
  }
  return value;
}

/** The fee day once the warning was delivered: never earlier than the warning plus the notice days. */
export function feeDateAfterNoticeKey(baseKey: string, noticeDeliveredKey: string, noticeDays: number): string {
  const earliest = addDaysToKey(noticeDeliveredKey, validateNoticeDays(noticeDays));
  return earliest > baseKey ? earliest : baseKey;
}

/** The larger of the flat fee and the percent of what is still owed, never over the $15 cap. Zero when no fee is set. */
export function lateFeeAmountCents(input: { flatCents: number; percent: number; outstandingCents: number }): number {
  const flat = Math.max(0, Math.trunc(input.flatCents));
  const percent = Math.max(0, input.percent);
  const byPercent = Math.round((Math.max(0, input.outstandingCents) * percent) / 100);
  return Math.min(LATE_FEE_CAP_CENTS, Math.max(flat, byPercent));
}

/** Household renter with a term over 4 months → consumer lease; household month-to-month or short → short; company → business. */
export function classifyLateFeeAgreement(input: {
  isBusiness: boolean;
  isPropertyManager: boolean;
  companyName: string | null;
  termMonths: number | null;
}): LateFeeClass {
  if (input.isBusiness || input.isPropertyManager || (input.companyName?.trim().length ?? 0) > 0) return "BUSINESS";
  if (input.termMonths === null) return "CONSUMER_SHORT";
  if (input.termMonths > 4) return "CONSUMER_LEASE";
  return "CONSUMER_SHORT";
}

export type LateFeeFacts = {
  todayKey: string;
  dueKey: string;
  graceDays: number;
  noticeDays: number;
  /** Colorado day the warning was delivered (accepted/delivered), or Chris's recorded phone call. Null = not warned. */
  warnedKey: string | null;
  /** A failed payment came after the warning: the customer needs a fresh one. */
  failedPaymentAfterWarning: boolean;
  outstandingCents: number;
  feeCents: number;
  /** Active-duty servicemember: no automatic fee. */
  militaryHold: boolean;
  /** The signed agreement names a late fee (flat or percent above zero). */
  agreementNamesFee: boolean;
  /** A bank payment is being confirmed, or a payment page was started and has not expired. */
  paymentInProgress: boolean;
  alreadyCharged: boolean;
  /** The fee date already promised to the customer in a delivered warning. A later change to the notice setting never moves it earlier. */
  communicatedFeeKey?: string | null;
};

export type LateFeeDecision =
  | { kind: "NONE"; reason: "ALREADY_CHARGED" | "PAID" | "NO_FEE_TERMS" | "WINDOW_PASSED" | "TOO_EARLY" | "NOT_YET_NOTICE_DAY" }
  | { kind: "MILITARY_REVIEW" }
  | { kind: "RENOTICE" }
  | { kind: "SEND_NOTICE"; feeDateKey: string }
  | { kind: "NEEDS_WARNING" }
  | { kind: "WAIT"; reason: "PAYMENT_IN_PROGRESS" | "FEE_DAY_NOT_REACHED" }
  | { kind: "RECORD_FEE"; feeCents: number };

/**
 * What to do with one overdue bill today. Order matters: money safety first (already charged, paid, no terms,
 * the 30-day window), then people (servicemembers), then "tell them first", then "never during a payment".
 */
export function decideLateFee(facts: LateFeeFacts): LateFeeDecision {
  if (facts.alreadyCharged) return { kind: "NONE", reason: "ALREADY_CHARGED" };
  if (facts.outstandingCents <= 0) return { kind: "NONE", reason: "PAID" };
  if (!facts.agreementNamesFee || facts.feeCents <= 0) return { kind: "NONE", reason: "NO_FEE_TERMS" };
  const windowEnd = addDaysToKey(facts.dueKey, LATE_FEE_WINDOW_DAYS);
  if (facts.todayKey > windowEnd) return { kind: "NONE", reason: "WINDOW_PASSED" };
  if (facts.militaryHold) return { kind: "MILITARY_REVIEW" };

  const baseKey = baseFeeDateKey(facts.dueKey, facts.graceDays);
  const warnedKey = facts.failedPaymentAfterWarning ? null : facts.warnedKey;
  if (facts.failedPaymentAfterWarning) {
    // The earlier warning no longer covers the customer: tell them again, then count the fee days from that warning.
    return { kind: "RENOTICE" };
  }

  if (warnedKey === null) {
    // Not warned. Send the warning on the notice day; once the base fee day has passed with nobody warned, Chris decides.
    if (facts.todayKey >= baseKey) return { kind: "NEEDS_WARNING" };
    if (facts.todayKey >= noticeDateKey(baseKey, facts.noticeDays)) return { kind: "SEND_NOTICE", feeDateKey: baseKey };
    return { kind: "NONE", reason: "NOT_YET_NOTICE_DAY" };
  }

  const computedKey = feeDateAfterNoticeKey(baseKey, warnedKey, facts.noticeDays);
  const feeDateKey = facts.communicatedFeeKey && facts.communicatedFeeKey > computedKey ? facts.communicatedFeeKey : computedKey;
  if (feeDateKey > windowEnd) return { kind: "NONE", reason: "WINDOW_PASSED" };
  if (facts.todayKey < feeDateKey) return { kind: "WAIT", reason: "FEE_DAY_NOT_REACHED" };
  if (facts.paymentInProgress) return { kind: "WAIT", reason: "PAYMENT_IN_PROGRESS" };
  return { kind: "RECORD_FEE", feeCents: facts.feeCents };
}

/**
 * Autopay rule: the fee may go on an upcoming automatic charge only when that charge is at least 10 calendar days away.
 * Otherwise it waits for the following bill. A customer with no autopay is not covered by the 10-day rule.
 */
export function canJoinNextCharge(input: { todayKey: string; nextChargeKey: string | null; autopay: boolean }): boolean {
  if (!input.nextChargeKey) return false;
  if (!input.autopay) return true;
  return daysBetweenKeys(input.todayKey, input.nextChargeKey) >= AUTOPAY_NOTICE_DAYS;
}
