import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import type { NoticeCertifierChoice } from "./notice-delivery";

/** Saves the two notice-delivery settings. Only the OWNER; re-checked inside the transaction; logged. */
export async function setNoticeDeliverySettings(userId: string, roles: NoticeCertifierChoice, days: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const before = await tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { noticeCertifierRoles: true, mailNoticeTransitDays: true },
    });
    await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", noticeCertifierRoles: roles, mailNoticeTransitDays: days },
      update: { noticeCertifierRoles: roles, mailNoticeTransitDays: days },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "settings.notice_delivery",
        entityType: "BusinessSettings",
        entityId: "singleton",
        oldValue: before ?? {},
        newValue: { noticeCertifierRoles: roles, mailNoticeTransitDays: days },
      },
    });
  });
}
