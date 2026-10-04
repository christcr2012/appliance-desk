import type { MaintenanceStatus, Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// A maintenance request follows its repair visit (Batch C, P2-D). Callers hold the request row lock
// (lock order: ... MaintenanceRequest, then Job) before calling in. Only a MAINTENANCE_VISIT job linked to the
// request ever calls these.
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

export async function lockMaintenanceRequestInTx(tx: Tx, requestId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "MaintenanceRequest" WHERE "id" = ${requestId} FOR UPDATE`;
  if (rows.length !== 1) throw new Error("Couldn't find that maintenance request.");
}

async function moveRequest(tx: Tx, userId: string | null, requestId: string, from: MaintenanceStatus[], to: MaintenanceStatus, reason: string, jobId: string): Promise<boolean> {
  const current = await tx.maintenanceRequest.findUnique({ where: { id: requestId }, select: { status: true, completedAt: true } });
  if (!current || !from.includes(current.status)) return false;
  const moved = await tx.maintenanceRequest.updateMany({
    where: { id: requestId, status: current.status },
    data: { status: to, completedAt: to === "RESOLVED" ? (current.completedAt ?? new Date()) : current.completedAt },
  });
  if (moved.count !== 1) return false;
  await tx.auditLog.create({
    data: { userId, action: "maintenance.status", entityType: "MaintenanceRequest", entityId: requestId, oldValue: { status: current.status }, newValue: { status: to, reason, jobId } },
  });
  return true;
}

/** Starting the repair visit moves a scheduled request to "in progress". */
export async function requestAfterVisitStartedInTx(tx: Tx, userId: string | null, requestId: string, jobId: string): Promise<void> {
  await moveRequest(tx, userId, requestId, ["SCHEDULED"], "IN_PROGRESS", "Repair visit started", jobId);
}

async function hasOtherOpenVisit(tx: Tx, requestId: string, jobId: string): Promise<boolean> {
  return (
    (await tx.job.count({
      where: { maintenanceRequestId: requestId, type: "MAINTENANCE_VISIT", id: { not: jobId }, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
    })) > 0
  );
}

/**
 * The request after its visit ended. A fully repaired visit resolves it; anything else (partly done, no access,
 * cancelled, no-show) never does: it goes back to "reviewing" unless another visit is still open.
 */
export async function requestAfterVisitEndedInTx(
  tx: Tx,
  userId: string | null,
  requestId: string,
  jobId: string,
  how: "REPAIRED" | "NOT_FINISHED" | "CANCELLED",
): Promise<void> {
  if (how === "REPAIRED") {
    await moveRequest(tx, userId, requestId, ["SCHEDULED", "IN_PROGRESS"], "RESOLVED", "Repair visit completed", jobId);
    return;
  }
  if (await hasOtherOpenVisit(tx, requestId, jobId)) return;
  await moveRequest(tx, userId, requestId, ["SCHEDULED", "IN_PROGRESS"], "REVIEWING", how === "CANCELLED" ? "Repair visit cancelled" : "Repair not finished", jobId);
}
