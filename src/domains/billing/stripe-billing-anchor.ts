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
