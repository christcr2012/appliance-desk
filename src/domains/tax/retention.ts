import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { cancelPendingDecisionChangesInTx } from "@/domains/decisions/pending";

import { RECOMMENDED_RETENTION_YEARS, retentionYearsProblem } from "./retention-rules";

export { RECOMMENDED_RETENTION_YEARS, retentionYearsProblem };

/** Owner-only, audited, compare-and-set so two sessions cannot overwrite each other silently. */
export async function saveRecordRetentionYears(actorId: string, years: number, expectedYears: number): Promise<void> {
  const problem = retentionYearsProblem(years);
  if (problem) throw new Error(problem);
  if (!Number.isInteger(expectedYears)) throw new Error("Reload the page and try again.");
  await prisma.$transaction((tx) => saveRecordRetentionYearsInTx(tx, actorId, years, expectedYears));
}

/** The same save inside a transaction the caller owns (Decisions & reviews). */
export async function saveRecordRetentionYearsInTx(
  tx: Prisma.TransactionClient, actorId: string, years: number, expectedYears: number,
): Promise<void> {
  const problem = retentionYearsProblem(years);
  if (problem) throw new Error(problem);
  if (!Number.isInteger(expectedYears)) throw new Error("Reload the page and try again.");
  await assertActiveTeamActor(tx, actorId, ["OWNER"]);
  const changed = await tx.businessSettings.updateMany({
    where: { id: "singleton", recordRetentionYears: expectedYears }, data: { recordRetentionYears: years },
  });
  if (changed.count !== 1) throw new Error("This setting was changed in another session. Reload before saving.");
  if (years !== expectedYears)
    await cancelPendingDecisionChangesInTx(tx, actorId, ["IN-71"], "A newer record-keeping period was saved.");
  await tx.auditLog.create({
    data: { userId: actorId, action: "tax.record_retention.update", entityType: "BusinessSettings", entityId: "singleton",
      oldValue: { recordRetentionYears: expectedYears }, newValue: { recordRetentionYears: years } },
  });
}

export async function getRecordRetentionYears(): Promise<number> {
  const settings = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { recordRetentionYears: true } });
  return settings?.recordRetentionYears ?? RECOMMENDED_RETENTION_YEARS;
}
