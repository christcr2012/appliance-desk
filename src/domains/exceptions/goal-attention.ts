import type { ExceptionItem } from "./rules";
import { getAlertSettings, getFleetUtilizationPercent, getGoalProgress, listIdleAppliances } from "@/domains/goals";
import { formatMoney } from "@/lib/money-ui";

/** At most three Today items, never per appliance: goal behind pace, idle appliances, low fleet utilization. */
export async function listGoalAttention(now: Date): Promise<ExceptionItem[]> {
  const out: ExceptionItem[] = [];
  const [progress, settings] = await Promise.all([getGoalProgress(now), getAlertSettings()]);
  for (const g of progress) {
    if (g.pace?.status !== "BEHIND" || g.target === null) continue;
    const show = (n: number) => (g.metric === "cash" ? formatMoney(n) : String(n));
    out.push({
      category: "GOAL_BEHIND", severity: "medium",
      title: `${g.label}: ${show(g.actual)} so far, about ${show(g.pace.expectedSoFar)} expected by today`,
      detail: `Your goal for this month is ${show(g.target)}. This is only a nudge; nothing is wrong with the books.`,
      href: "/desk/settings/goals", since: now,
    });
  }
  const idle = await listIdleAppliances(settings.idleDays, now);
  if (idle.total > 0) {
    out.push({
      category: "IDLE_APPLIANCES", severity: "medium",
      title: `${idle.total} ready-to-rent appliance${idle.total === 1 ? " has" : "s have"} sat idle ${settings.idleDays}+ days`,
      detail: "No customer has had them in that time. Consider a promotion, a price change or selling them.",
      href: "/desk/inventory", since: now,
    });
  }
  if (settings.utilizationPercent !== null) {
    const pct = await getFleetUtilizationPercent(now);
    if (pct !== null && pct < settings.utilizationPercent) {
      out.push({
        category: "LOW_UTILIZATION", severity: "medium",
        title: `Only ${pct}% of your appliance time was rented in the last 30 days`,
        detail: `Your alert is set for anything under ${settings.utilizationPercent}%.`,
        href: "/desk/fleet", since: now,
      });
    }
  }
  return out;
}
