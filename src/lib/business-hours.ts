// AR-9 (INSIGHTS section 4): how many of the minutes between two instants
// fall inside the business's opening hours. Pure: the caller loads Settings,
// parses the stored hours with parseStoredHours and passes the holiday
// closure date keys (Denver "YYYY-MM-DD") from parseStoredClosures.
//
// Rules (from the spec):
// - Only minutes inside a day's open-close window count, on Denver days.
// - A day with no entry, a day marked closed, and a holiday closure day
//   count nothing.
// - When NO opening hours are set at all, every minute counts (the Insights
//   screen's definition note says it is counting around the clock).
import { businessDateKey, businessDateTimeFromLocal } from "@/lib/business-date";
import type { DayId, StoredHours } from "@/domains/settings/profile-extras";

const DAY_IDS: readonly DayId[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function nextKey(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function dayIdOf(key: string): DayId {
  return DAY_IDS[new Date(`${key}T00:00:00Z`).getUTCDay()]!;
}

export function hasAnyOpeningHours(hours: StoredHours): boolean {
  return Object.values(hours).some((d) => d !== undefined && !("closed" in d));
}

export function businessMinutesBetween(
  start: Date,
  end: Date,
  hours: StoredHours,
  holidayClosures: ReadonlySet<string> | readonly string[] = [],
): number {
  if (end.getTime() <= start.getTime()) return 0;
  if (!hasAnyOpeningHours(hours)) {
    return Math.floor((end.getTime() - start.getTime()) / 60_000);
  }
  const closures = holidayClosures instanceof Set ? holidayClosures : new Set(holidayClosures);
  let totalMs = 0;
  let key = businessDateKey(start);
  const lastKey = businessDateKey(end);
  // Bounded: even a year of days is a short loop, and lead response times
  // are far shorter than that.
  for (let guard = 0; guard < 400 && key <= lastKey; guard++) {
    if (!closures.has(key)) {
      const entry = hours[dayIdOf(key)];
      if (entry && !("closed" in entry)) {
        const open = businessDateTimeFromLocal(`${key}T${entry.open}`);
        const close = businessDateTimeFromLocal(`${key}T${entry.close}`);
        if (open && close) {
          const overlapStart = Math.max(start.getTime(), open.getTime());
          const overlapEnd = Math.min(end.getTime(), close.getTime());
          if (overlapEnd > overlapStart) totalMs += overlapEnd - overlapStart;
        }
      }
    }
    key = nextKey(key);
  }
  return Math.floor(totalMs / 60_000);
}
