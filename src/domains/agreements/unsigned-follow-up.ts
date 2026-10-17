import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

export const RECOMMENDED_UNSIGNED_FOLLOW_UP_DAYS = 3;

export async function getUnsignedFollowUpDays(): Promise<number> {
  const s = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { unsignedFollowUpDays: true } });
  return s?.unsignedFollowUpDays ?? RECOMMENDED_UNSIGNED_FOLLOW_UP_DAYS;
}

/** Owner-only, audited, compare-and-set. */
export async function saveUnsignedFollowUpDays(actorId: string, days: number, expectedDays: number): Promise<void> {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("Enter a whole number of days from 1 to 30.");
  if (!Number.isInteger(expectedDays)) throw new Error("Reload the page and try again.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const changed = await tx.businessSettings.updateMany({
      where: { id: "singleton", unsignedFollowUpDays: expectedDays }, data: { unsignedFollowUpDays: days },
    });
    if (changed.count !== 1) throw new Error("This setting was changed in another session. Reload before saving.");
    await tx.auditLog.create({
      data: { userId: actorId, action: "agreement.unsigned_follow_up_days.update", entityType: "BusinessSettings", entityId: "singleton",
        oldValue: { unsignedFollowUpDays: expectedDays }, newValue: { unsignedFollowUpDays: days } },
    });
  });
}
