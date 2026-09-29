import { prisma } from "@/lib/prisma";
import type { MaintenanceStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Desk-side maintenance request handling — see docs/BUSINESS-RULES.md's
// "Maintenance status flow": submitted -> reviewing -> scheduled ->
// in_progress -> resolved -> closed. Chris is notified of new requests
// (see docs/ROADMAP.md — email notification for these isn't wired up
// yet, same gap as leads had before Phase 2's Resend integration); the
// customer sees status updates in their own portal (src/domains/portal).
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  SUBMITTED: ["REVIEWING", "CLOSED"],
  REVIEWING: ["SCHEDULED", "CLOSED"],
  SCHEDULED: ["IN_PROGRESS", "CLOSED"],
  IN_PROGRESS: ["RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

/** Pure — see tests/maintenance.test.ts. CLOSED is reachable from any
 * non-terminal status (a request can always be closed out — duplicate,
 * customer withdrew, etc.) even though the "happy path" is linear. */
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

/** Total MaintenanceRequest count matching the same optional status filter
 * as getMaintenanceRequests — used to clamp the page number for
 * /desk/maintenance's paginated view. See src/domains/pagination.ts. */
export async function getMaintenanceRequestsCount(
  filter?: { status?: MaintenanceStatus },
): Promise<number> {
  return prisma.maintenanceRequest.count({
    where: filter?.status ? { status: filter.status } : undefined,
  });
}

/** Paginated variant of getMaintenanceRequests. */
export async function getMaintenanceRequestsPage(
  filter: { status?: MaintenanceStatus } | undefined,
  skip: number,
  pageSize: number,
) {
  return prisma.maintenanceRequest.findMany({
    where: filter?.status ? { status: filter.status } : undefined,
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      appliance: { include: { applianceType: true } },
    },
    orderBy: [{ openedAt: "desc" }],
    skip,
    take: pageSize,
  });
}

export async function getMaintenanceRequestById(id: string) {
  return prisma.maintenanceRequest.findUnique({
    where: { id },
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      appliance: { include: { applianceType: true } },
      jobs: { orderBy: [{ scheduledAt: "desc" }] },
      // The customer's own photo(s) of the problem, if they attached any
      // when submitting (2026-09-28) — see src/domains/portal/index.ts's
      // createMaintenanceRequestForUser.
      photos: { orderBy: [{ createdAt: "asc" }] },
    },
  });
}

export async function updateMaintenanceStatus(
  userId: string,
  requestId: string,
  newStatus: MaintenanceStatus,
) {
  const before = await prisma.maintenanceRequest.findUniqueOrThrow({
    where: { id: requestId },
  });

  const check = canTransitionMaintenanceStatus(before.status, newStatus);
  if (!check.ok) {
    throw new Error(check.reason);
  }

  const updated = await prisma.maintenanceRequest.update({
    where: { id: requestId },
    data: {
      status: newStatus,
      completedAt:
        newStatus === "RESOLVED" || newStatus === "CLOSED"
          ? (before.completedAt ?? new Date())
          : before.completedAt,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "maintenance.status",
      entityType: "MaintenanceRequest",
      entityId: requestId,
      oldValue: { status: before.status },
      newValue: { status: newStatus },
    },
  });

  return updated;
}
