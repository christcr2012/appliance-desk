import type { ApplianceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor, type TeamRole } from "@/lib/team-actor";
import { assertJobScopeInTx } from "@/domains/jobs/scope";
import { canTransitionApplianceStatus } from "./lifecycle";
import { assertStatusChangeKeepsCustody } from "./custody";

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
  jobId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, userId);
    // Staff change an appliance's status only from a job they may work, and only for an appliance on that job.
    if (actor.role === "STAFF" && !jobId) {
      throw new Error("This appliance is not linked to the originating job.");
    }
    if (jobId) {
      await assertJobScopeInTx(tx, { userId, role: actor.role as TeamRole }, { jobId, applianceId, write: "SWAP_STATUS" });
    }

    const before = await tx.appliance.findUniqueOrThrow({
      where: { id: applianceId },
    });
    const check = canTransitionApplianceStatus(before.status, newStatus);
    if (!check.ok) throw new Error(check.reason);

    await assertStatusChangeKeepsCustody(tx, applianceId, newStatus);

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
