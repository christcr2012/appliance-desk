import type { ApplianceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { canTransitionApplianceStatus } from "./lifecycle";

/**
 * Team-actor version of an appliance status change for operational flows
 * where STAFF is allowed. The actor row is locked and re-checked in the
 * same transaction as the appliance mutation and audit write, so removing
 * staff access is a hard boundary even for an already-started request.
 */
export async function updateApplianceStatusAsTeamActor(
  userId: string,
  applianceId: string,
  newStatus: ApplianceStatus,
) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId);

    const before = await tx.appliance.findUniqueOrThrow({
      where: { id: applianceId },
    });
    const check = canTransitionApplianceStatus(before.status, newStatus);
    if (!check.ok) throw new Error(check.reason);

    const result = await tx.appliance.updateMany({
      where: { id: applianceId, updatedAt: before.updatedAt },
      data: { status: newStatus },
    });
    if (result.count !== 1) {
      throw new Error(
        "Someone else changed this appliance just now — reload the page to see their update before saving yours.",
      );
    }

    const updated = await tx.appliance.findUniqueOrThrow({
      where: { id: applianceId },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "appliance.unit.status",
        entityType: "Appliance",
        entityId: applianceId,
        oldValue: { status: before.status },
        newValue: { status: newStatus },
      },
    });

    return updated;
  });
}
