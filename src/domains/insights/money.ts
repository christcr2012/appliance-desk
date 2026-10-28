// AR-9 (INSIGHTS section 6): the Money Overview's rent-health read. OWNER
// and ADMIN only — this wrapper refuses everyone else before touching the
// underlying reads (which stay session-free for To do rules and cron).
import { requireRole } from "@/lib/session";
import { getRevenueDashboard } from "@/domains/billing";
import type { MrrTrendPoint } from "@/domains/billing/revenue";
import { getGoalProgress, type GoalProgress } from "@/domains/goals";
import { getEarningsReport, type AgreementEarningsRow } from "@/domains/reports";

/** Moved from the old Reports page (AR-9): a rent gap worth showing starts at $10.00. */
export const NOTABLE_GAP_CENTS = 1000;

export type RentHealth = {
  mrrCents: number;
  arrCents: number;
  /** The revenue dashboard's 6-month expected monthly rent series. */
  mrrTrend: MrrTrendPoint[];
  goals: GoalProgress[];
  /** Agreements paying at least $10.00 less than agreed, worst gap first. */
  notableGaps: AgreementEarningsRow[];
};

export async function getRentHealth(now = new Date()): Promise<RentHealth> {
  await requireRole("OWNER", "ADMIN");
  const [dashboard, goals, earnings] = await Promise.all([
    getRevenueDashboard(now),
    getGoalProgress(now),
    getEarningsReport(now),
  ]);
  return {
    mrrCents: dashboard.mrrCents,
    arrCents: dashboard.arrCents,
    mrrTrend: dashboard.mrrTrend,
    goals,
    notableGaps: earnings.rows.filter((row) => row.gapCents >= NOTABLE_GAP_CENTS),
  };
}
