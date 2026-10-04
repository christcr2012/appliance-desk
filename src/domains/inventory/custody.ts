import type { ApplianceCustodyEpisode, ApplianceStatus, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

// ---------------------------------------------------------------------------
// Physical custody (Batch C, slice P2-A). An episode opens when a completed delivery, installation or
// swap replacement records DELIVERED for an appliance, and closes when a completed removal or swap
// return records RETURNED. Nothing else opens or closes one: renewals, agreement endings and
// assignment changes never touch custody. At most one episode is open per appliance (database rule).
// Lock order: callers hold the Appliance row lock (spec section 0, step 6) before calling in.
// ---------------------------------------------------------------------------

export class CustodyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustodyConflictError";
  }
}

type Reader = PrismaClient | Prisma.TransactionClient;

export async function getOpenCustody(client: Reader, applianceId: string): Promise<ApplianceCustodyEpisode | null> {
  return client.applianceCustodyEpisode.findFirst({ where: { applianceId, closedAt: null } });
}

export async function openCustodyEpisodeInTx(
  tx: Prisma.TransactionClient,
  input: {
    applianceId: string;
    customerId: string;
    serviceAddressId: string | null;
    agreementId: string | null;
    startedOn: Date;
    startJobId: string;
  },
): Promise<{ episodeId: string; alreadyOpenForThisJob: boolean }> {
  const open = await getOpenCustody(tx, input.applianceId);
  if (open) {
    if (open.startJobId === input.startJobId) return { episodeId: open.id, alreadyOpenForThisJob: true };
    throw new CustodyConflictError("This appliance is already recorded as being with a customer. Close that stay first.");
  }
  const sameJob = await tx.applianceCustodyEpisode.findUnique({
    where: { startJobId_applianceId: { startJobId: input.startJobId, applianceId: input.applianceId } },
    select: { id: true },
  });
  if (sameJob) return { episodeId: sameJob.id, alreadyOpenForThisJob: true };
  const created = await tx.applianceCustodyEpisode.create({
    data: {
      applianceId: input.applianceId,
      customerId: input.customerId,
      serviceAddressId: input.serviceAddressId,
      agreementId: input.agreementId,
      startedOn: input.startedOn,
      startEvidence: "JOB",
      startJobId: input.startJobId,
    },
  });
  return { episodeId: created.id, alreadyOpenForThisJob: false };
}

export async function closeCustodyEpisodeInTx(
  tx: Prisma.TransactionClient,
  input: { applianceId: string; endedOn: Date; endJobId: string; endReason: string },
): Promise<{ episodeId: string; alreadyClosedByThisJob: boolean }> {
  const open = await getOpenCustody(tx, input.applianceId);
  if (!open) {
    const already = await tx.applianceCustodyEpisode.findUnique({
      where: { endJobId_applianceId: { endJobId: input.endJobId, applianceId: input.applianceId } },
      select: { id: true },
    });
    if (already) return { episodeId: already.id, alreadyClosedByThisJob: true };
    throw new CustodyConflictError("This appliance is not recorded as being with a customer, so there is no stay to close.");
  }
  if (open.startedOn && input.endedOn.getTime() < open.startedOn.getTime()) {
    throw new CustodyConflictError("The return date is before the date this appliance was delivered. Check the date the work was done.");
  }
  const closed = await tx.applianceCustodyEpisode.updateMany({
    where: { id: open.id, closedAt: null },
    data: { closedAt: new Date(), endedOn: input.endedOn, endEvidence: "JOB", endJobId: input.endJobId, endReason: input.endReason },
  });
  if (closed.count !== 1) throw new CustodyConflictError("This appliance's stay was just closed by someone else. Reload and check.");
  return { episodeId: open.id, alreadyClosedByThisJob: false };
}

/**
 * The two one-way custody rules for a hand-made status change: "rented" or "awaiting pickup" needs a recorded
 * holder, and "available", "reserved" or "retired" can't keep one. Deliveries and pickups go through job completion,
 * which opens and closes the stay itself, so a hand change must not skip it.
 */
export async function assertStatusChangeKeepsCustody(client: Reader, applianceId: string, newStatus: ApplianceStatus): Promise<void> {
  if (newStatus !== "RENTED" && newStatus !== "AWAITING_PICKUP" && newStatus !== "AVAILABLE" && newStatus !== "RESERVED" && newStatus !== "RETIRED") return;
  const open = await getOpenCustody(client, applianceId);
  if ((newStatus === "RENTED" || newStatus === "AWAITING_PICKUP") && !open) {
    throw new CustodyConflictError("This appliance has no customer recorded, so it can't be marked as out with a customer. Complete a delivery job for it, or record who has it on this page first.");
  }
  if ((newStatus === "AVAILABLE" || newStatus === "RESERVED" || newStatus === "RETIRED") && open) {
    throw new CustodyConflictError("This appliance is recorded as being with a customer. Complete a pickup job for it before changing it to this status.");
  }
}

/** Appliances whose status says "with a customer" but that have no open episode. Should be empty after the owner fills any gaps. */
export async function findCustodyGaps(client: Reader): Promise<Array<{ applianceId: string; status: ApplianceStatus }>> {
  const rows = await client.appliance.findMany({
    where: { status: { in: ["RENTED", "AWAITING_PICKUP"] }, archivedAt: null, custodyEpisodes: { none: { closedAt: null } } },
    select: { id: true, status: true },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => ({ applianceId: row.id, status: row.status }));
}

/** Appliances that break the two one-way custody rules (rented/awaiting-pickup without an open stay; available/reserved/retired with one). */
export async function findCustodyInvariantViolations(client: Reader): Promise<Array<{ applianceId: string; status: ApplianceStatus; open: boolean }>> {
  const withoutOpen = await findCustodyGaps(client);
  const withOpen = await client.appliance.findMany({
    where: { status: { in: ["AVAILABLE", "RESERVED", "RETIRED"] }, custodyEpisodes: { some: { closedAt: null } } },
    select: { id: true, status: true },
    orderBy: { id: "asc" },
  });
  return [
    ...withoutOpen.map((row) => ({ applianceId: row.applianceId, status: row.status, open: false })),
    ...withOpen.map((row) => ({ applianceId: row.id, status: row.status, open: true })),
  ];
}

/** The owner records who has an appliance when the system could not work it out (a MANUAL episode). */
export async function recordManualCustody(
  userId: string,
  input: { applianceId: string; customerId: string; serviceAddressId: string | null; startedOn: Date | null; reason: string },
): Promise<void> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Say how you know this customer has it (for example, “confirmed by phone”).");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ${input.applianceId} FOR UPDATE`;
    const appliance = await tx.appliance.findUnique({ where: { id: input.applianceId }, select: { status: true } });
    if (!appliance) throw new Error("Couldn't find that appliance.");
    if (appliance.status === "AVAILABLE" || appliance.status === "RESERVED" || appliance.status === "RETIRED") {
      throw new Error("An appliance that is available, reserved or retired is in the shop, so it can't be with a customer.");
    }
    if (await getOpenCustody(tx, input.applianceId)) throw new CustodyConflictError("This appliance already has a customer recorded.");
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, archivedAt: null }, select: { id: true } });
    if (!customer) throw new Error("Choose a customer.");
    if (input.serviceAddressId) {
      const address = await tx.serviceAddress.findFirst({ where: { id: input.serviceAddressId, customerId: input.customerId }, select: { id: true } });
      if (!address) throw new Error("That address doesn't belong to this customer.");
    }
    const episode = await tx.applianceCustodyEpisode.create({
      data: {
        applianceId: input.applianceId,
        customerId: input.customerId,
        serviceAddressId: input.serviceAddressId,
        startedOn: input.startedOn,
        startEvidence: "MANUAL",
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "appliance.custody.manual",
        entityType: "Appliance",
        entityId: input.applianceId,
        newValue: { episodeId: episode.id, customerId: input.customerId, reason },
      },
    });
  });
}
