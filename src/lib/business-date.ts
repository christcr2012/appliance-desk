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

export function businessDayBounds(now = new Date()) {
  const key = businessDateKey(now);
  const next = new Date(`${key}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    start: midnight(key),
    end: midnight(next.toISOString().slice(0, 10)),
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
