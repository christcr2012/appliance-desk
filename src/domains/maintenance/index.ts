import { prisma } from "@/lib/prisma";
import type { MaintenanceStatus } from "@prisma/client";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { createJobInTx } from "@/domains/jobs";
import { lockUsersForScheduling } from "@/domains/jobs/scheduling";
import { lockMaintenanceRequestInTx } from "./visit-sync";

const ALLOWED_TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  SUBMITTED: ["REVIEWING", "CLOSED"],
  REVIEWING: ["SCHEDULED", "CLOSED"],
  // SCHEDULED/IN_PROGRESS -> REVIEWING is what happens when a repair visit is cancelled or not finished.
  SCHEDULED: ["IN_PROGRESS", "REVIEWING", "CLOSED"],
  IN_PROGRESS: ["RESOLVED", "REVIEWING", "CLOSED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export function canTransitionMaintenanceStatus(
  from: MaintenanceStatus,
  to: MaintenanceStatus,
): { ok: true } | { ok: false; reason: string } {
  if (from === to) {
    return { ok: false, reason: "That's already its current status." };
  }
  if (ALLOWED_TRANSITIONS[from].includes(to)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `Can't move a maintenance request directly from ${from} to ${to}.`,
  };
}

export async function getMaintenanceRequestsCount(
  filter?: { status?: MaintenanceStatus },
): Promise<number> {
  return prisma.maintenanceRequest.count({
    where: filter?.status ? { status: filter.status } : undefined,
  });
}

export async function getMaintenanceRequestsPage(
  filter: { status?: MaintenanceStatus } | undefined,
  skip: number,
  pageSize: number,
) {
  return prisma.maintenanceRequest.findMany({
    where: filter?.status ? { status: filter.status } : undefined,
    include: {
      customer: {
        include: { user: { select: { name: true, email: true } } },
      },
      appliance: { include: { applianceType: true } },
    },
    orderBy: [{ openedAt: "desc" }, { id: "desc" }],
    skip,
    take: pageSize,
  });
}

export async function getMaintenanceRequestById(id: string) {
  return prisma.maintenanceRequest.findUnique({
    where: { id },
    include: {
      customer: {
        include: { user: { select: { name: true, email: true } } },
      },
      appliance: { include: { applianceType: true } },
      jobs: { orderBy: [{ scheduledAt: "desc" }] },
      photos: { orderBy: [{ createdAt: "asc" }] },
    },
  });
}

/**
 * Status eligibility is still expressed by the pure transition graph above,
 * but the database now claims the exact status that was validated. Two
 * overlapping transitions from the same old state cannot both succeed, and
 * the winning state change and its audit evidence commit together.
 */
export async function updateMaintenanceStatus(
  userId: string,
  requestId: string,
  newStatus: MaintenanceStatus,
) {
  const before = await prisma.maintenanceRequest.findUniqueOrThrow({
    where: { id: requestId },
  });
  const check = canTransitionMaintenanceStatus(before.status, newStatus);
  if (!check.ok) throw new Error(check.reason);

  return prisma.$transaction(async (tx) => {
    const changed = await tx.maintenanceRequest.updateMany({
      where: { id: requestId, status: before.status },
      data: {
        status: newStatus,
        completedAt:
          newStatus === "RESOLVED" || newStatus === "CLOSED"
            ? (before.completedAt ?? new Date())
            : before.completedAt,
      },
    });
    if (changed.count !== 1) {
      throw new Error(
        "This maintenance request was just changed by someone else — refresh and try again.",
      );
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: "maintenance.status",
        entityType: "MaintenanceRequest",
        entityId: requestId,
        oldValue: { status: before.status },
        newValue: { status: newStatus },
      },
    });

    return tx.maintenanceRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
  });
}

export type ScheduleMaintenanceInput = {
  requestId: string;
  scheduledAt: Date;
  durationMinutes: number | null;
  assignedToUserId: string | null;
  serviceAddressId: string;
  /** Visits the person has already agreed to overlap; anything else that conflicts is refused. */
  confirmedConflictJobIds: readonly string[];
};

/**
 * Schedules a repair visit for a request in one transaction: the request moves "reviewing" to "scheduled"
 * (a request already in progress keeps its status for a second visit), the visit job is created for the request's
 * customer, chosen property and appliance, and the audit entries are written. All of it commits or none of it does.
 */
export async function scheduleMaintenanceRequest(userId: string, input: ScheduleMaintenanceInput): Promise<{ jobId: string }> {
  return prisma.$transaction(async (tx) => {
    // Lock order (spec section 0): the people involved, then the request, then the job.
    await lockUsersForScheduling(tx, [userId, input.assignedToUserId]);
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await lockMaintenanceRequestInTx(tx, input.requestId);
    const request = await tx.maintenanceRequest.findUniqueOrThrow({ where: { id: input.requestId } });

    if (request.status === "SUBMITTED") throw new Error("Review this request first (mark it Reviewing), then schedule the visit.");
    if (request.status === "SCHEDULED") throw new Error("A visit is already scheduled for this request.");
    if (request.status !== "REVIEWING" && request.status !== "IN_PROGRESS") {
      throw new Error("This request is already finished, so a new visit can't be scheduled for it.");
    }
    if (request.status === "REVIEWING") {
      const moved = await tx.maintenanceRequest.updateMany({ where: { id: request.id, status: "REVIEWING" }, data: { status: "SCHEDULED", serviceAddressId: input.serviceAddressId } });
      if (moved.count !== 1) throw new Error("This maintenance request was just changed by someone else — refresh and try again.");
    } else {
      await tx.maintenanceRequest.update({ where: { id: request.id }, data: { serviceAddressId: input.serviceAddressId } });
    }

    const job = await createJobInTx(tx, userId, {
      type: "MAINTENANCE_VISIT",
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      assignedToUserId: input.assignedToUserId,
      customerId: request.customerId,
      serviceAddressId: input.serviceAddressId,
      maintenanceRequestId: request.id,
      applianceIds: request.applianceId ? [request.applianceId] : [],
      notes: request.problem,
      confirmedConflictJobIds: input.confirmedConflictJobIds,
    });

    if (request.status === "REVIEWING") {
      await tx.auditLog.create({
        data: { userId, action: "maintenance.status", entityType: "MaintenanceRequest", entityId: request.id, oldValue: { status: "REVIEWING" }, newValue: { status: "SCHEDULED", reason: "Repair visit scheduled", jobId: job.id } },
      });
    }
    return { jobId: job.id };
  });
}
