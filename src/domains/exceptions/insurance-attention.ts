import type { ExceptionItem } from "./rules";
import { loadInsuranceOverview } from "@/domains/insurance/reads";
import { KIND_LABELS } from "@/domains/insurance/rules";

/** Owner To do items: a policy ending soon (first and second reminder), an ended policy, and workers' comp needed now. */
export async function listInsuranceAttention(now: Date): Promise<ExceptionItem[]> {
  const overview = await loadInsuranceOverview(now);
  const rows: ExceptionItem[] = [];
  for (const p of overview.policies) {
    if (p.archivedAt || p.state.kind === "ok") continue;
    const label = KIND_LABELS[p.kind];
    const title = p.state.kind === "expired"
      ? `${label} insurance ended ${p.state.daysOver} day${p.state.daysOver === 1 ? "" : "s"} ago`
      : `${label} insurance ends in ${p.state.daysLeft} day${p.state.daysLeft === 1 ? "" : "s"}`;
    rows.push({
      category: "INSURANCE_RENEWAL", severity: p.state.kind === "first" ? "medium" : "high", title,
      detail: `${p.insurer}, policy ${p.policyNumber}. Call your agent about renewing, then update the end date on the Insurance screen.`,
      href: "/desk/insurance", since: p.expiresOn,
      // One steady identity per policy and stage, so "snooze for a week" lasts instead of reappearing when the countdown in the title changes.
      todoKey: `insurance-renewal:${p.id}:${p.state.kind}`,
    });
  }
  if (overview.workersCompRequired) {
    rows.push({
      category: "INSURANCE_RENEWAL", severity: "high", title: "Workers' compensation insurance is required now",
      detail: "You have employees. Colorado requires workers' compensation coverage once you do. Talk to your insurance agent, then record the policy on the Insurance screen.",
      href: "/desk/insurance#workers-comp", since: now, todoKey: "insurance-workers-comp-required",
    });
  }
  return rows;
}
