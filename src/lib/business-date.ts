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

export function businessDayBounds(now = new Date()) {
  const key = businessDateKey(now);
  return {
    start: midnight(key),
    end: midnight(addCalendarDays(key, 1)),
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
  const start = businessDateFromKey(key);
  if (!start) throw new Error(`Invalid business date: ${key}`);
  return new Date(midnight(addCalendarDays(key, 1)).getTime() - 1000);
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
