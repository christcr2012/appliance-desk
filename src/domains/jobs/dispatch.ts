import { businessDateKey, businessDateFromKey, businessDayBounds, addBusinessDays } from "@/lib/business-date";

// ---------------------------------------------------------------------------
// Dispatch board (2026-09-28) — pure scheduling/conflict logic, zero-
// database-import, same spirit as lifecycle.ts and checklist.ts. Chris is
// a one-person (or small) crew, so "conflict" means two jobs booked
// close enough together that he can't physically be at both.
// ---------------------------------------------------------------------------

/** How long a visit is assumed to occupy, for conflict-detection
 * purposes only — jobs don't record an actual duration, and asking
 * Chris to estimate one for every job would be more friction than the
 * feature is worth. Two hours is a deliberately generous default for an
 * appliance delivery/install/removal/repair visit, including drive time
 * to the next stop. */
export const ASSUMED_JOB_DURATION_MINUTES = 120;

export type DispatchableJob = {
  id: string;
  scheduledAt: Date | null;
};

/** Which scheduled jobs overlap another scheduled job closely enough
 * (within ASSUMED_JOB_DURATION_MINUTES of each other) that Chris likely
 * can't make both — returned as a Set of job ids to flag, so the board
 * can badge them without changing anything about the jobs themselves.
 * Unscheduled jobs (scheduledAt: null) are never flagged — there's
 * nothing to conflict with yet. */
export function findConflictingJobIds(jobs: DispatchableJob[]): Set<string> {
  const timed = jobs
    .filter((j): j is DispatchableJob & { scheduledAt: Date } => j.scheduledAt !== null)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  const conflicting = new Set<string>();
  const windowMs = ASSUMED_JOB_DURATION_MINUTES * 60 * 1000;

  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const gap = timed[j].scheduledAt.getTime() - timed[i].scheduledAt.getTime();
      if (gap >= windowMs) break; // sorted, so nothing further out can conflict either
      conflicting.add(timed[i].id);
      conflicting.add(timed[j].id);
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
