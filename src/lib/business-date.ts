/** Instants use Colorado time. Date-only task deadlines retain their stored UTC date. */
export const BUSINESS_TIME_ZONE = "America/Denver";
const dateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function businessDateKey(date: Date): string {
  const parts = dateParts.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function midnight(key: string): Date {
  const target = Date.parse(`${key}T00:00:00Z`);
  let instant = target;
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  // Resolve each midnight separately: a Colorado calendar day can be 23 or 25 hours.
  for (let i = 0; i < 3; i++) {
    const parts = clock.formatToParts(new Date(instant));
    const part = (type: string) => parts.find((p) => p.type === type)!.value;
    const wall = Date.parse(
      `${businessDateKey(new Date(instant))}T${part("hour")}:${part("minute")}:${part("second")}Z`,
    );
    instant += target - wall;
  }
  return new Date(instant);
}

function addCalendarDays(key: string, days: number): string {
  const calendar = new Date(`${key}T00:00:00Z`);
  calendar.setUTCDate(calendar.getUTCDate() + days);
  return calendar.toISOString().slice(0, 10);
}

function firstOfNextMonth(key: string): string {
  const [year, month] = key.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return next.toISOString().slice(0, 10);
}

export function businessDayBounds(now = new Date()) {
  const key = businessDateKey(now);
  return {
    start: midnight(key),
    end: midnight(addCalendarDays(key, 1)),
  };
}

/** Colorado-local month boundaries, resolving DST at each midnight separately. */
export function businessMonthBounds(now = new Date()) {
  const key = businessDateKey(now);
  const startKey = `${key.slice(0, 7)}-01`;
  return {
    start: midnight(startKey),
    end: midnight(firstOfNextMonth(startKey)),
  };
}

/** Validate a calendar date, then resolve its Colorado midnight. */
export function businessDateFromKey(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const date = new Date(`${key}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== key) return null;
  return midnight(key);
}

/**
 * Resolve the last whole second of a Colorado business date. This is safe
 * across DST transitions because the next local midnight is resolved first;
 * callers such as Stripe `cancel_at` can therefore use a real business-day
 * boundary without assuming every local day is exactly 24 hours long.
 */
export function businessDateEnd(key: string): Date {
  if (!businessDateFromKey(key)) throw new Error(`Invalid business date: ${key}`);
  return new Date(midnight(addCalendarDays(key, 1)).getTime() - 1000);
}

/**
 * Last whole second of the Colorado business date that contains `date`.
 * Same boundary Stripe `cancel_at` uses, exposed for any caller that holds an
 * instant rather than a date key.
 */
export function businessEndOfDay(date: Date): Date {
  return businessDateEnd(businessDateKey(date));
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Anniversary date key `monthsAhead` months after `anchorKey`, same day-of-month, clamped to the month's last day. */
function anniversaryKey(anchorKey: string, monthsAhead: number): string {
  const [year, month, day] = anchorKey.split("-").map(Number);
  const index = year * 12 + (month - 1) + monthsAhead;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

/**
 * Anniversary billing period number `monthsAhead` for an agreement whose
 * billing anchor is `anchor` (BUSINESS-RULES: same day each month, no
 * proration). Period 0 starts on the anchor's Colorado date. Each period is
 * computed from the anchor, never chained from the previous one, so a Jan 31
 * anchor bills Feb 28, Mar 31, Apr 30 rather than drifting to the 28th.
 * `start` is the Colorado midnight that opens the period; `end` is the
 * Colorado midnight that opens the next one (exclusive), so periods tile with
 * no gap or overlap even across daylight-saving changes.
 */
export function billingPeriodFor(
  anchor: Date,
  monthsAhead: number,
): { start: Date; end: Date } {
  if (!Number.isInteger(monthsAhead) || monthsAhead < 0) {
    throw new Error("monthsAhead must be a whole number of months, zero or more.");
  }
  const anchorKey = businessDateKey(anchor);
  return {
    start: midnight(anniversaryKey(anchorKey, monthsAhead)),
    end: midnight(anniversaryKey(anchorKey, monthsAhead + 1)),
  };
}

/**
 * Last second of a fixed term that starts at `termStart` (owner decision
 * IN-20, 2026-10-03: a term starts at delivery, when billing starts). A
 * 12-month term starting Nov 8 ends 23:59:59 Colorado time on Nov 7 of the
 * next year: the day before the anniversary that would open month 13.
 */
export function fixedTermEndDate(termStart: Date, termMonths: number): Date {
  if (!Number.isInteger(termMonths) || termMonths < 1) {
    throw new Error("A fixed term must be a whole number of months, one or more.");
  }
  return new Date(billingPeriodFor(termStart, termMonths).start.getTime() - 1000);
}

/** Whole Colorado calendar days from `from`'s date to `to`'s date (negative when `to` is earlier). */
export function businessDaysBetween(from: Date, to: Date): number {
  const a = Date.parse(`${businessDateKey(from)}T00:00:00Z`);
  const b = Date.parse(`${businessDateKey(to)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function addBusinessDays(date: Date, days: number): Date {
  return midnight(addCalendarDays(businessDateKey(date), days));
}

export function formatBusinessDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatBusinessTime(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export type TaskDueFilter =
  "all" | "overdue" | "today" | "upcoming" | "undated";
export function taskDueBucket(
  dueDate: Date | null,
  now = new Date(),
): Exclude<TaskDueFilter, "all"> {
  if (!dueDate) return "undated";
  const due = new Date(dueDate).toISOString().slice(0, 10);
  const today = businessDateKey(now);
  return due < today ? "overdue" : due === today ? "today" : "upcoming";
}

export function formatTaskDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}
