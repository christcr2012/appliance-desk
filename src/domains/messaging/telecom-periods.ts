const DAY = 86_400_000;

/**
 * The two whole-day (GMT) periods the spending report reads: this month so far (through yesterday) and the month before.
 * Both ends are inclusive midnight dates. Shared so the nightly sync fetches exactly what the report asks for.
 */
export function telecomReportPeriods(now: Date) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastDay = new Date(+today - DAY);
  const currentMonthHasFinishedDay = +lastDay >= +start;
  const currentStart = currentMonthHasFinishedDay ? start : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const priorStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (currentMonthHasFinishedDay ? 1 : 2), 1));
  const priorEnd = new Date(+currentStart - DAY);
  return {
    current: { start: currentStart, end: lastDay },
    previous: { start: priorStart, end: priorEnd },
  };
}
