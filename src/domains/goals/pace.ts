// O-5: pure goal math. No database, no clock. Easy to test.

export const GOAL_METRICS = {
  cash: { label: "Money collected", unit: "dollars", help: "Payments you actually received this month (checks, cash, cards)." },
  newRentals: { label: "New rentals", unit: "count", help: "Rentals that start this month." },
} as const;
export type GoalMetric = keyof typeof GOAL_METRICS;

export function isGoalMetric(value: string): value is GoalMetric {
  return Object.prototype.hasOwnProperty.call(GOAL_METRICS, value);
}

/** No "behind" warning in the first week: a slow start is normal and the numbers are too small to mean much. */
export const PACE_QUIET_DAYS = 7;
/** Behind means under this share of where a straight-line pace would be today. */
export const PACE_BEHIND_SHARE = 0.75;

export type PaceStatus = "MET" | "ON_PACE" | "BEHIND" | "TOO_EARLY";

export type Pace = {
  status: PaceStatus;
  /** Where a straight-line pace would be today, rounded to a whole number. */
  expectedSoFar: number;
  percentOfTarget: number;
};

/** `dayOfMonth` is 1-based (Colorado calendar); `daysInMonth` is 28 to 31. */
export function computePace(input: { target: number; actual: number; dayOfMonth: number; daysInMonth: number }): Pace {
  const { target, actual, dayOfMonth, daysInMonth } = input;
  const percentOfTarget = target > 0 ? Math.floor((actual / target) * 100) : 0;
  const expectedSoFar = Math.round((target * Math.min(dayOfMonth, daysInMonth)) / daysInMonth);
  if (target > 0 && actual >= target) return { status: "MET", expectedSoFar, percentOfTarget };
  if (dayOfMonth <= PACE_QUIET_DAYS) return { status: "TOO_EARLY", expectedSoFar, percentOfTarget };
  const status = actual < expectedSoFar * PACE_BEHIND_SHARE ? "BEHIND" : "ON_PACE";
  return { status, expectedSoFar, percentOfTarget };
}

export function validateTarget(metric: GoalMetric, value: number): string | null {
  if (!Number.isSafeInteger(value) || value <= 0) return "Enter a target above zero.";
  if (metric === "cash" && value > 100_000_000) return "That target is too large. Enter a smaller amount.";
  if (metric === "newRentals" && value > 100_000) return "That target is too large. Enter a smaller number.";
  return null;
}

export function validateIdleDays(days: number): string | null {
  return Number.isSafeInteger(days) && days >= 0 && days <= 365 ? null : "Enter a number of days from 0 to 365 (0 turns the warning off).";
}

export function validateUtilizationPercent(value: number | null): string | null {
  if (value === null) return null;
  return Number.isSafeInteger(value) && value >= 1 && value <= 99 ? null : "Enter a percent from 1 to 99, or leave it empty to turn the warning off.";
}
