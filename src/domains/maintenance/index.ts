import { prisma } from "@/lib/prisma";
import type { MaintenanceStatus } from "@prisma/client";

const ALLOWED_TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  SUBMITTED: ["REVIEWING", "CLOSED"],
  REVIEWING: ["SCHEDULED", "CLOSED"],
  SCHEDULED: ["IN_PROGRESS", "CLOSED"],
  IN_PROGRESS: ["RESOLVED", "CLOSED"],
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
