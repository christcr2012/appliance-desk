import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

/** Saves the month-to-month notice settings. Owners and admins; re-checked inside the transaction; logged. */
export async function setMonthToMonthSettings(
  userId: string,
  values: { days: number; termsChangeNoticeText: string | null; annualReminderText: string | null },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const select = { monthToMonthChangeNoticeDays: true, termsChangeNoticeText: true, annualReminderText: true } as const;
    const before = await tx.businessSettings.findUnique({ where: { id: "singleton" }, select });
    const data = {
      monthToMonthChangeNoticeDays: values.days,
      termsChangeNoticeText: values.termsChangeNoticeText,
      annualReminderText: values.annualReminderText,
    };
    await tx.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...data }, update: data });
    await tx.auditLog.create({
      data: {
        userId,
        action: "settings.month_to_month",
        entityType: "BusinessSettings",
        entityId: "singleton",
        oldValue: before ?? {},
        newValue: data,
      },
    });
  });
}
