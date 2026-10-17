import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

export const RECOMMENDED_RETENTION_YEARS = 7;

/** Owner-only, audited, compare-and-set so two sessions cannot overwrite each other silently. */
export async function saveRecordRetentionYears(actorId: string, years: number, expectedYears: number): Promise<void> {
  if (!Number.isInteger(years) || years < 1 || years > 50) throw new Error("Enter a whole number of years from 1 to 50.");
  if (!Number.isInteger(expectedYears)) throw new Error("Reload the page and try again.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const changed = await tx.businessSettings.updateMany({
      where: { id: "singleton", recordRetentionYears: expectedYears }, data: { recordRetentionYears: years },
    });
    if (changed.count !== 1) throw new Error("This setting was changed in another session. Reload before saving.");
    await tx.auditLog.create({
      data: { userId: actorId, action: "tax.record_retention.update", entityType: "BusinessSettings", entityId: "singleton",
        oldValue: { recordRetentionYears: expectedYears }, newValue: { recordRetentionYears: years } },
    });
  });
}

export async function getRecordRetentionYears(): Promise<number> {
  const settings = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { recordRetentionYears: true } });
  return settings?.recordRetentionYears ?? RECOMMENDED_RETENTION_YEARS;
}
