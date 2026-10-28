// AR-9 (INSIGHTS section 5): the Equipment Insights read. OWNER and ADMIN
// only — this wrapper refuses everyone else first, then runs the current
// /desk/fleet page's reads unchanged (same page/costs params).
import { requireRole } from "@/lib/session";
import { getApplianceCountsByStatus, getFleetAnalytics, type ApplianceProfitability } from "@/domains/inventory";
import { fleetReportPage } from "@/domains/inventory/fleet-report";
import { getFleetUtilizationPercent, listIdleAppliances, getAlertSettings } from "@/domains/goals";
import { getUtilizationFlags, type UtilizationFlagRow } from "@/domains/growth";
import { getDemandEstimate, type DemandEstimateRow } from "@/domains/growth/demand";
import { getJobsMissingRepairCost } from "@/domains/reports";

export type EquipmentInsights = {
  totals: Awaited<ReturnType<typeof getFleetAnalytics>>["totals"];
  countsByStatus: Awaited<ReturnType<typeof getApplianceCountsByStatus>>;
  /** Total appliances across every status (the counts record's sum). */
  totalAppliances: number;
  rentedOut: number;
  available: number;
  utilizationPercent: number | null;
  idle: Awaited<ReturnType<typeof listIdleAppliances>>;
  idleDays: number;
  mostUsed: ApplianceProfitability[];
  leastUsed: ApplianceProfitability[];
  highestRepairCosts: ApplianceProfitability[];
  flags: UtilizationFlagRow[];
  demand: DemandEstimateRow[];
  jobsMissingRepairCost: Awaited<ReturnType<typeof getJobsMissingRepairCost>>;
  report: ReturnType<typeof fleetReportPage>;
};

export async function getEquipmentInsights(
  params: { page?: string; costs?: string } = {},
  now = new Date(),
): Promise<EquipmentInsights> {
  await requireRole("OWNER", "ADMIN");
  const [analytics, countsByStatus, utilizationPercent, alerts, flags, demand, missingCost] =
    await Promise.all([
      getFleetAnalytics(now),
      getApplianceCountsByStatus(),
      getFleetUtilizationPercent(now),
      getAlertSettings(),
      getUtilizationFlags(now),
      getDemandEstimate(),
      getJobsMissingRepairCost(),
    ]);
  const idle = await listIdleAppliances(alerts.idleDays, now);
  const appliances = analytics.appliances;
  // The fleet page's own top-5 derivations, unchanged.
  const byUtilization = [...appliances].sort((a, b) => b.utilizationFraction - a.utilizationFraction);
  const totalAppliances = Object.values(countsByStatus).reduce((sum, n) => sum + n, 0);
  return {
    totals: analytics.totals,
    countsByStatus,
    totalAppliances,
    rentedOut: countsByStatus.RENTED ?? 0,
    available: countsByStatus.AVAILABLE ?? 0,
    utilizationPercent,
    idle,
    idleDays: alerts.idleDays,
    mostUsed: byUtilization.slice(0, 5),
    leastUsed: [...byUtilization].reverse().slice(0, 5),
    highestRepairCosts: [...appliances]
      .filter((a) => a.repairCostCents > 0)
      .sort((a, b) => b.repairCostCents - a.repairCostCents)
      .slice(0, 5),
    flags,
    demand,
    jobsMissingRepairCost: missingCost,
    report: fleetReportPage(appliances, params.page, params.costs === "missing"),
  };
}
