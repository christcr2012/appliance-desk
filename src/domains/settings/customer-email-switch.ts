import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

/**
 * The owner's master switch for emails sent to customers. Starts OFF. Only the OWNER
 * can change it (turning it on is the decision to start contacting real customers), the
 * person is re-checked inside the same transaction, and every change is logged.
 * Previews and test copies never send, whatever this says (see `src/lib/email.ts`).
 */
export async function isCustomerEmailEnabled(): Promise<boolean> {
  const row = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { customerEmailEnabled: true },
  });
  return row?.customerEmailEnabled === true;
}

export async function setCustomerEmailEnabled(userId: string, enabled: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const before = await tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { customerEmailEnabled: true },
    });
    await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", customerEmailEnabled: enabled },
      update: { customerEmailEnabled: enabled },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: enabled ? "settings.customer_email_on" : "settings.customer_email_off",
        entityType: "BusinessSettings",
        entityId: "singleton",
        oldValue: { customerEmailEnabled: before?.customerEmailEnabled ?? false },
        newValue: { customerEmailEnabled: enabled },
      },
    });
  });
}
