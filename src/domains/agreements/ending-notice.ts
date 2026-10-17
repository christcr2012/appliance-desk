import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

export const RECOMMENDED_ENDING_NOTICE_DAYS = 30;

/** Owner-only, audited, compare-and-set (same pattern as the record-keeping setting). */
export async function saveRentalEndingNoticeDays(actorId: string, days: number, expectedDays: number): Promise<void> {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Enter a whole number of days from 1 to 365.");
  if (!Number.isInteger(expectedDays)) throw new Error("Reload the page and try again.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const changed = await tx.businessSettings.updateMany({
      where: { id: "singleton", rentalEndingNoticeDays: expectedDays }, data: { rentalEndingNoticeDays: days },
    });
    if (changed.count !== 1) throw new Error("This setting was changed in another session. Reload before saving.");
    await tx.auditLog.create({
      data: { userId: actorId, action: "agreement.ending_notice_days.update", entityType: "BusinessSettings", entityId: "singleton",
        oldValue: { rentalEndingNoticeDays: expectedDays }, newValue: { rentalEndingNoticeDays: days } },
    });
  });
}

export async function getRentalEndingNoticeDays(): Promise<number> {
  const s = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { rentalEndingNoticeDays: true } });
  return s?.rentalEndingNoticeDays ?? RECOMMENDED_ENDING_NOTICE_DAYS;
}
