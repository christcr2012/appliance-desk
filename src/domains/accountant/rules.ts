import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

// ACCT-1: pure rules for the accountant level (no database).

/**
 * The invite form's starting value for "access ends on": the next May 1 (after the April tax deadline),
 * as the END of that Denver day — access works through May 1 and stops on May 2.
 */
export function nextMayFirstEnd(from: Date): Date {
  const todayKey = businessDateKey(from); // Denver date, YYYY-MM-DD
  const year = Number(todayKey.slice(0, 4));
  const thisMay = `${year}-05-01`;
  const key = todayKey < thisMay ? thisMay : `${year + 1}-05-01`;
  const start = businessDateFromKey(key)!;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** A picked calendar date (YYYY-MM-DD) as the END of that Denver day — access works through that date. */
export function endOfDenverDayKey(key: string): Date {
  const start = businessDateFromKey(key);
  if (!start) throw new Error("That access end date doesn't look right.");
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Whole days from `now` until `endsOn` (negative once it has passed), by Denver calendar days. */
export function daysUntilAccessEnds(endsOn: Date, now: Date): number {
  const a = businessDateKey(endsOn);
  const b = businessDateKey(now);
  const ms = businessDateFromKey(a)!.getTime() - businessDateFromKey(b)!.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/** The To do thresholds (spec section 3): warn 14 days before the end; remind about open-ended access at 6 months. */
export function accessEndAttentionKind(
  user: { accessEndsOn: Date | null; createdAt: Date },
  now: Date,
): "ending-soon" | "ended" | "open-ended-old" | null {
  if (user.accessEndsOn) {
    const days = daysUntilAccessEnds(user.accessEndsOn, now);
    if (days < 0) return "ended";
    if (days <= 14) return "ending-soon";
    return null;
  }
  const sixMonthsAgo = new Date(now.getTime() - 182 * 24 * 60 * 60 * 1000);
  return user.createdAt <= sixMonthsAgo ? "open-ended-old" : null;
}
