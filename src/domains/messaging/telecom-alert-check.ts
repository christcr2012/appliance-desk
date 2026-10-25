import { prisma } from "@/lib/prisma";
import { communicationsPolicySchema } from "./communications-policy";
import { getTelecomSpend } from "./telecom-costs-store";
import { telecomReportPeriods } from "./telecom-periods";

/**
 * Nightly read-only spend-alert check. It evaluates the owner's saved alert rules against the provider's reported spend and
 * returns how many warnings WOULD be raised. It never notifies anyone: that waits on the owner's budget answers (IN-53).
 * If the owner has not turned the rules on, nothing is checked.
 */
export async function runTelecomAlertPreview(accountIds: readonly string[], now = new Date()): Promise<{ checked: number; warnings: number }> {
  const settings = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { communicationsPolicy: true } });
  const policy = communicationsPolicySchema.safeParse(settings?.communicationsPolicy);
  const rules = policy.success ? policy.data.telecomCostAlerts : undefined;
  if (!rules?.enabled) return { checked: 0, warnings: 0 };
  const reader = await prisma.user.findFirst({ where: { role: "OWNER", archivedAt: null }, select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (!reader) return { checked: 0, warnings: 0 };
  const { current } = telecomReportPeriods(now);
  let checked = 0, warnings = 0;
  for (const accountId of accountIds) {
    const spend = await getTelecomSpend({ accountId, actorUserId: reader.id, periodStart: current.start, periodEnd: current.end, now,
      tolerance: { absoluteCents: 0, percentBasisPoints: null, combination: "ANY" }, alertRules: rules });
    checked++;
    warnings += spend.alertPreview?.candidates.length ?? 0;
  }
  return { checked, warnings };
}
