import type { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Swaps (Batch C, slice P2-C). Staging a swap reserves only the replacement unit; the original stays
// with the customer until completion moves everything at once. A reservation the swap owns is marked
// `JobAppliance.reservationActive`, and these helpers give it back when the swap does not happen.
// Callers hold the lock order from the spec (customer, agreement, job) before calling in.
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

/** Releases the replacement reservations a swap job owns: only units still RESERVED go back to AVAILABLE. */
export async function releaseSwapReservationsInTx(tx: Tx, userId: string | null, jobId: string, reason: string): Promise<string[]> {
  const owned = await tx.jobAppliance.findMany({
    where: { jobId, reservationActive: true },
    select: { applianceId: true },
    orderBy: { applianceId: "asc" },
  });
  if (owned.length === 0) return [];
  const ids = owned.map((row) => row.applianceId);
  await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ANY(${ids}) ORDER BY "id" FOR UPDATE`;
  const released: string[] = [];
  for (const applianceId of ids) {
    const moved = await tx.appliance.updateMany({ where: { id: applianceId, status: "RESERVED" }, data: { status: "AVAILABLE" } });
    if (moved.count === 1) {
      released.push(applianceId);
      await tx.auditLog.create({
        data: { userId, action: "appliance.unit.status", entityType: "Appliance", entityId: applianceId, oldValue: { status: "RESERVED" }, newValue: { status: "AVAILABLE", reason, jobId } },
      });
    }
  }
  // On a swap job the row stays (the job is cancelled with it). On a delivery visit that carried a substitute for a
  // waiting item, the substitute row is dropped so the visit's list is just what it is really delivering.
  const job = await tx.job.findUnique({ where: { id: jobId }, select: { type: true } });
  if (job && job.type !== "SWAP") {
    await tx.jobAppliance.deleteMany({ where: { jobId, reservationActive: true, role: "REPLACEMENT", result: null } });
  }
  await tx.jobAppliance.updateMany({ where: { jobId, reservationActive: true }, data: { reservationActive: false } });
  // A waiting item whose substitute just went back on the shelf is waiting for its own unit again.
  await tx.pendingDelivery.updateMany({
    where: { substituteJobId: jobId, deliveredOn: null, removedAt: null },
    data: { substituteApplianceId: null, substituteJobId: null },
  });
  return released;
}

/** Ending an agreement gives back every unit a delivery visit still has set aside as a substitute for a waiting item. */
export async function releaseSubstitutesForAgreementInTx(tx: Tx, userId: string | null, agreementId: string, reason: string): Promise<void> {
  const jobs = await tx.job.findMany({
    where: { agreementId, type: { in: ["DELIVERY", "INSTALLATION"] }, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, appliances: { some: { reservationActive: true } } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const job of jobs) await releaseSwapReservationsInTx(tx, userId, job.id, reason);
}

/** Ending an agreement cancels a swap still waiting for it and gives its reserved replacement back. */
export async function cancelStagedSwapsForAgreementInTx(tx: Tx, userId: string | null, agreementId: string): Promise<string[]> {
  const jobs = await tx.job.findMany({
    where: { agreementId, type: "SWAP", status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
    select: { id: true, status: true },
    orderBy: { id: "asc" },
  });
  for (const job of jobs) {
    await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${job.id} FOR UPDATE`;
    const moved = await tx.job.updateMany({
      where: { id: job.id, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
      data: { status: "CANCELLED", version: { increment: 1 } },
    });
    if (moved.count !== 1) continue;
    await releaseSwapReservationsInTx(tx, userId, job.id, "Agreement ended");
    await tx.auditLog.create({
      data: { userId, action: "job.status", entityType: "Job", entityId: job.id, oldValue: { status: job.status }, newValue: { status: "CANCELLED", reason: "Agreement ended" } },
    });
  }
  return jobs.map((job) => job.id);
}
