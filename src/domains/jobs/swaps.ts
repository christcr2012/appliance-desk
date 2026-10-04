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
  await tx.jobAppliance.updateMany({ where: { jobId, reservationActive: true }, data: { reservationActive: false } });
  return released;
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
