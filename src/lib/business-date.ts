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

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Turn what a person typed into a date-time box ("2026-03-08T09:30", read as Colorado clock time)
 * into the real instant. Returns null for malformed input and for a time that does not exist
 * (the hour skipped when clocks spring forward). For the repeated hour in fall-back it picks the
 * first occurrence. Never uses the server's own time zone.
 */
export function businessDateTimeFromLocal(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const target = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  const check = new Date(target);
  if (
    check.getUTCFullYear() !== Number(y) || check.getUTCMonth() !== Number(mo) - 1 ||
    check.getUTCDate() !== Number(d) || check.getUTCHours() !== Number(h) || check.getUTCMinutes() !== Number(mi)
  ) {
    return null;
  }
  const wallOf = (instant: number) => {
    const parts = wallClock.formatToParts(new Date(instant));
    const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  };
  // Candidate offsets: the offset in effect a day before and a day after bracket any transition.
  const offsets = new Set<number>();
  for (const probe of [target - 86_400_000, target + 86_400_000]) offsets.add(wallOf(probe) - probe);
  const matches = [...offsets]
    .map((offset) => target - offset)
    .filter((instant) => wallOf(instant) === target)
    .sort((a, b) => a - b);
  return matches.length > 0 ? new Date(matches[0]) : null;
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

// ---- Banking days (BILL-1) ----
// A bank payment is confirmed on banking days: Monday to Friday in Colorado, skipping Federal Reserve holidays.
// (`addBusinessDays` above adds CALENDAR days and its other callers rely on that, so it is left alone.)

const WEEKDAY_OF_KEY = (key: string): number => new Date(`${key}T00:00:00Z`).getUTCDay(); // 0 = Sunday … 6 = Saturday

function nthWeekdayKey(year: number, month: number, weekday: number, nth: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lastWeekdayKey(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  const back = (last.getUTCDay() - weekday + 7) % 7;
  return `${year}-${String(month).padStart(2, "0")}-${String(last.getUTCDate() - back).padStart(2, "0")}`;
}

const holidayCache = new Map<number, Set<string>>();

/** Federal Reserve holidays that fall in `year`. A Sunday holiday is observed Monday; a Saturday holiday is NOT moved (Fed practice). */
function federalReserveHolidays(year: number): Set<string> {
  const known = holidayCache.get(year);
  if (known) return known;
  const fixed = [`${year}-01-01`, `${year}-06-19`, `${year}-07-04`, `${year}-11-11`, `${year}-12-25`].map((key) =>
    WEEKDAY_OF_KEY(key) === 0 ? addCalendarDays(key, 1) : key,
  );
  const set = new Set<string>([
    ...fixed,
    nthWeekdayKey(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekdayKey(year, 2, 1, 3), // Presidents Day
    lastWeekdayKey(year, 5, 1), // Memorial Day
    nthWeekdayKey(year, 9, 1, 1), // Labor Day
    nthWeekdayKey(year, 10, 1, 2), // Columbus Day
    nthWeekdayKey(year, 11, 4, 4), // Thanksgiving
  ]);
  holidayCache.set(year, set);
  return set;
}

function isBankingDayKey(key: string): boolean {
  const weekday = WEEKDAY_OF_KEY(key);
  if (weekday === 0 || weekday === 6) return false;
  // A Sunday New Year's Day observed Monday Jan 1 is in this year's set; a Sunday Dec 31 never matters (Jan 1 is Monday then).
  return !federalReserveHolidays(Number(key.slice(0, 4))).has(key);
}

/** The Colorado date `days` banking days after (or, when negative, before) `date`'s date, as that day's Colorado midnight. */
export function addBankingDays(date: Date, days: number): Date {
  let key = businessDateKey(date);
  const step = days < 0 ? -1 : 1;
  for (let left = Math.abs(days); left > 0; ) {
    key = addCalendarDays(key, step);
    if (isBankingDayKey(key)) left -= 1;
  }
  return midnight(key);
}

/**
 * Whole banking days from `from`'s Colorado date to `to`'s: the banking days after `from`'s date up to and including
 * `to`'s date (negative when `to` is earlier). A payment started Friday is 4 banking days old on Thursday.
 */
export function bankingDaysBetween(from: Date, to: Date): number {
  const a = businessDateKey(from);
  const b = businessDateKey(to);
  if (a === b) return 0;
  const [early, late, sign] = a < b ? [a, b, 1] : [b, a, -1];
  let count = 0;
  for (let key = addCalendarDays(early, 1); key <= late; key = addCalendarDays(key, 1)) {
    if (isBankingDayKey(key)) count += 1;
  }
  return sign * count;
}

export function formatBusinessDate(date: Date, language: "en"|"es" = "en") {
  return new Intl.DateTimeFormat(language==="es"?"es-US":"en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

const clockParts = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minutes after midnight, Colorado time, for an instant (0 to 1439). Used to place a visit on the day timeline. */
export function businessMinuteOfDay(date: Date): number {
  const parts = clockParts.formatToParts(date);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return (part("hour") % 24) * 60 + part("minute");
}

export function formatBusinessTime(date: Date, language: "en"|"es" = "en") {
  return new Intl.DateTimeFormat(language==="es"?"es-US":"en-US", {
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

/**
 * Read a date-only form box. Blank means "not given". Anything that is not a real
 * calendar date is rejected, never guessed at or rolled over. The result is the
 * start (Colorado midnight) of that business date, for fields that mean "on this
 * day" such as a purchase date. Deadlines use `businessDateEnd` instead.
 */
export function parseOptionalBusinessDate(
  value: string | null | undefined,
): { ok: true; value: Date | null } | { ok: false } {
  const text = (value ?? "").trim();
  if (!text) return { ok: true, value: null };
  const date = businessDateFromKey(text);
  return date ? { ok: true, value: date } : { ok: false };
}

// ---------------------------------------------------------------------------------------------------------------
// AR-0 kit date words (docs/build-specs/KIT.md section 8). All America/Denver; never format dates by hand on screens.

const shortDate = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, month: "short", day: "numeric" });
const shortDateWithYear = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});
const monthYear = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, month: "long", year: "numeric" });
const weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, weekday: "long" });

/** "Oct 25" when `date` falls in the same Colorado year as `now`, otherwise "Oct 25, 2025". The list/card default. */
export function formatShortDate(date: Date, now: Date = new Date()): string {
  const sameYear = businessDateKey(date).slice(0, 4) === businessDateKey(now).slice(0, 4);
  return (sameYear ? shortDate : shortDateWithYear).format(date);
}

/** "March 2026" (Colorado time). */
export function formatMonthYear(date: Date): string {
  return monthYear.format(date);
}

/** "Sunday, Oct 25" (Colorado time) — Today's date line. */
export function formatWeekdayDate(date: Date): string {
  return `${weekdayName.format(date)}, ${shortDate.format(date)}`;
}

/**
 * Colorado calendar-day distance in words: "today", "yesterday", "tomorrow", "in 3 days", "3 days ago". More than six
 * days away falls back to `formatShortDate`.
 */
export function relativeBusinessDay(date: Date, now: Date = new Date()): string {
  const days = businessDaysBetween(now, date);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1 && days <= 6) return `in ${days} days`;
  if (days < -1 && days >= -6) return `${-days} days ago`;
  return formatShortDate(date, now);
}

/** Monday 00:00 Colorado time of the week that contains `now` (weeks run Monday to Sunday). */
export function businessWeekStart(now: Date = new Date()): Date {
  const key = businessDateKey(now);
  const weekday = new Date(`${key}T00:00:00Z`).getUTCDay(); // 0 = Sunday … 6 = Saturday, of the Colorado date
  return midnight(addCalendarDays(key, -((weekday + 6) % 7)));
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th", 11 → "11th", 21 → "21st". */
export function ordinal(n: number): string {
  const whole = Math.trunc(n);
  const lastTwo = Math.abs(whole) % 100;
  const last = Math.abs(whole) % 10;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13 ? "th" : last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th";
  return `${whole}${suffix}`;
}
