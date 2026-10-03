import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

/**
 * The owner's master switch for AUTOMATIC renewals. Starts OFF. While it is off nothing is queued, started or
 * extended automatically, even for customers who agreed to it when they signed. A customer turning auto-renew
 * off, an early ending, and cancelling a queued renewal always keep working. Only the OWNER can change it; the
 * person is re-checked inside the same transaction and every change is logged.
 */
export async function isAutoRenewEnabled(): Promise<boolean> {
  const row = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { autoRenewEnabled: true },
  });
  return row?.autoRenewEnabled === true;
}

export async function setAutoRenewEnabled(userId: string, enabled: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const before = await tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { autoRenewEnabled: true },
    });
    await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", autoRenewEnabled: enabled },
      update: { autoRenewEnabled: enabled },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: enabled ? "settings.auto_renew_on" : "settings.auto_renew_off",
        entityType: "BusinessSettings",
        entityId: "singleton",
        oldValue: { autoRenewEnabled: before?.autoRenewEnabled ?? false },
        newValue: { autoRenewEnabled: enabled },
      },
    });
  });
}
