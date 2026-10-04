import { businessDateKey, businessDateFromKey, businessDayBounds, addBusinessDays } from "@/lib/business-date";

// ---------------------------------------------------------------------------
// Dispatch board (2026-09-28) — pure scheduling/conflict logic, zero-
// database-import, same spirit as lifecycle.ts and checklist.ts. Chris is
// a one-person (or small) crew, so "conflict" means two jobs booked
// close enough together that he can't physically be at both.
// ---------------------------------------------------------------------------

/** Fallback visit length, used only when the owner's setting cannot be read. The real value is
 * BusinessSettings.defaultJobDurationMinutes (Settings → Jobs). */
export const ASSUMED_JOB_DURATION_MINUTES = 120;

/** The longest a visit may be (spec P1-A); candidate windows look this far around the board. */
export const MAX_JOB_DURATION_MINUTES = 720;

export type DispatchableJob = {
  id: string;
  scheduledAt: Date | null;
  assignedToUserId?: string | null;
  durationMinutes?: number | null;
};

/** Which scheduled jobs overlap another job for the same person (jobs with no assigned person
 * form one shared "unassigned" group, a hint only) — returned as a Set of job ids to flag, so the
 * board can badge them without changing anything about the jobs themselves. Intervals are
 * half-open: a visit that ends exactly when the next starts does not conflict. A job with no
 * length of its own uses `defaultMinutes`. Unscheduled jobs are never flagged. */
export function findConflictingJobIds(
  jobs: DispatchableJob[],
  defaultMinutes: number = ASSUMED_JOB_DURATION_MINUTES,
): Set<string> {
  const groups = new Map<string, Array<DispatchableJob & { scheduledAt: Date }>>();
  for (const job of jobs) {
    if (job.scheduledAt === null) continue;
    const key = job.assignedToUserId ?? "";
    const list = groups.get(key) ?? [];
    list.push(job as DispatchableJob & { scheduledAt: Date });
    groups.set(key, list);
  }

  const conflicting = new Set<string>();
  for (const group of groups.values()) {
    const timed = group
      .map((j) => ({ id: j.id, start: j.scheduledAt.getTime(), end: j.scheduledAt.getTime() + (j.durationMinutes ?? defaultMinutes) * 60_000 }))
      .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        if (timed[j].start >= timed[i].end) break; // sorted by start, so nothing further out can overlap this one
        conflicting.add(timed[i].id);
        conflicting.add(timed[j].id);
      }
    }
  }
  return conflicting;
}

/** Group stored instants by their Colorado calendar day. */
export function dayKey(date: Date): string {
  return businessDateKey(date);
}

export function dispatchAnchor(value: string | undefined, now = new Date()): Date {
  return (value ? businessDateFromKey(value) : null) ?? businessDayBounds(now).start;
}

/** The 7 calendar days (Sunday first) containing `date`. */
export function weekDays(date: Date): Date[] {
  const calendar = new Date(`${dayKey(date)}T00:00:00Z`);
  const start = addBusinessDays(date, -calendar.getUTCDay());
  return Array.from({ length: 7 }, (_, i) => addBusinessDays(start, i));
}
