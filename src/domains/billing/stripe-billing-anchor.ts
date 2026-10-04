import { businessDateKey } from "@/lib/business-date";

export const STRIPE_BILLING_UTC_HOUR = 7;

/**
 * Encode an Appliance Desk Colorado billing date for Stripe at one fixed UTC
 * clock time. 07:00 UTC is midnight MST / 1 AM MDT, so it is always on the
 * intended Denver calendar date. Using the same clock for backdated starts and
 * recurring anchors prevents DST from shifting a renewal to the prior local
 * date or adding a partial-hour interval to a backdated invoice.
 */
export function stripeBillingDateSeconds(billingDate: Date): number {
  const key = businessDateKey(billingDate);
  return Math.floor(Date.parse(`${key}T${String(STRIPE_BILLING_UTC_HOUR).padStart(2, "0")}:00:00.000Z`) / 1000);
}

/**
 * Put a Colorado billing date on the UTC clock of an existing Stripe
 * subscription's real billing-cycle anchor. New Appliance Desk subscriptions
 * use 07:00 UTC, but subscriptions created before that contract can still use
 * another clock (for example 06:00 UTC). Cancellation must land on that actual
 * provider boundary or Stripe can treat it as part of the next period.
 */
export function stripeBillingDateSecondsAtProviderClock(
  billingDate: Date,
  billingCycleAnchorSeconds: number,
): number {
  if (!Number.isFinite(billingCycleAnchorSeconds) || billingCycleAnchorSeconds < 0) {
    throw new Error("Stripe billing-cycle anchor must be a non-negative finite timestamp.");
  }
  const key = businessDateKey(billingDate);
  const anchor = new Date(Math.floor(billingCycleAnchorSeconds) * 1000);
  const hour = String(anchor.getUTCHours()).padStart(2, "0");
  const minute = String(anchor.getUTCMinutes()).padStart(2, "0");
  const second = String(anchor.getUTCSeconds()).padStart(2, "0");
  return Math.floor(Date.parse(`${key}T${hour}:${minute}:${second}.000Z`) / 1000);
}

/**
 * Let Stripe preserve the original delivery day-of-month instead of pinning a
 * single next-anniversary timestamp. This matters for month-end anchors: a
 * January 31 delivery must recur Feb 28/29, Mar 31, Apr 30, then May 31 rather
 * than drifting permanently to the 28th.
 */
export function stripeBillingCycleAnchorConfig(billingDate: Date): {
  day_of_month: number;
  hour: number;
  minute: 0;
  second: 0;
} {
  const [, , day] = businessDateKey(billingDate).split("-").map(Number);
  return {
    day_of_month: day,
    hour: STRIPE_BILLING_UTC_HOUR,
    minute: 0,
    second: 0,
  };
}