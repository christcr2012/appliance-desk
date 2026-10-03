/** Instants use Colorado time. Date-only task deadlines retain their stored UTC date. */
export const BUSINESS_TIME_ZONE = "America/Denver";
const dateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const wallClockParts = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function businessDateKey(date: Date): string {
  const parts = dateParts.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function wallParts(date: Date) {
  const parts = wallClockParts.formatToParts(date);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function resolveWallTime(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}): Date {
  const target = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    input.second,
  );
  let instant = target;

  // Resolve the Colorado offset for the target wall clock without assuming a
  // fixed UTC offset. Repeating also handles the offset transition days.
  for (let i = 0; i < 4; i++) {
    const actual = wallParts(new Date(instant));
    const actualWall = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    instant += target - actualWall;
  }
  return new Date(instant);
}

function midnight(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return resolveWallTime({ year, month, day, hour: 0, minute: 0, second: 0 });
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

function shiftWallMonths(anchor: Date, months: number): Date {
  if (!Number.isInteger(months)) throw new Error("months must be a whole number.");
  const wall = wallParts(anchor);
  const monthIndex = wall.month - 1 + months;
  const year = wall.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(wall.day, daysInTargetMonth);
  return resolveWallTime({
    year,
    month: month + 1,
    day,
    hour: wall.hour,
    minute: wall.minute,
    second: wall.second,
  });
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
 * across DST transitions because the next local midnight is resolved first.
 */
export function businessDateEnd(key: string): Date {
  if (!businessDateFromKey(key)) throw new Error(`Invalid business date: ${key}`);
  return new Date(midnight(addCalendarDays(key, 1)).getTime() - 1000);
}

export function businessEndOfDay(date: Date): Date {
  return businessDateEnd(businessDateKey(date));
}

export function addBusinessDays(date: Date, days: number): Date {
  return midnight(addCalendarDays(businessDateKey(date), days));
}

/**
 * Anniversary billing period in Colorado local time. `end` is the exclusive
 * next anniversary boundary. Month-end anchors clamp to the target month's
 * last day; DST changes preserve the same local wall-clock time.
 */
export function billingPeriodFor(
  anchor: Date,
  monthsAhead: number,
): { start: Date; end: Date } {
  if (!Number.isFinite(anchor.getTime())) throw new Error("Invalid billing anchor.");
  if (!Number.isInteger(monthsAhead) || monthsAhead < 0) {
    throw new Error("monthsAhead must be a non-negative whole number.");
  }
  return {
    start: shiftWallMonths(anchor, monthsAhead),
    end: shiftWallMonths(anchor, monthsAhead + 1),
  };
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
