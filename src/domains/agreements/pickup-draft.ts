import type { Prisma } from "@prisma/client";

/**
 * Deciding that a rental ends creates exactly one unscheduled pickup visit (REMOVAL) for the owner to schedule.
 * It never dispatches, notifies or charges anything. A repeat finds the open one and returns it.
 */
export async function ensurePickupDraftInTx(tx: Prisma.TransactionClient, agreementId: string): Promise<string | null> {
  const agreement = await tx.rentalAgreement.findUnique({
    where: { id: agreementId }, select: { id: true, customerId: true, serviceAddressId: true, status: true },
  });
  if (!agreement || agreement.status !== "ACTIVE") return null;
  const existing = await tx.job.findFirst({
    where: { agreementId, type: "REMOVAL", status: { not: "CANCELLED" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true },
  });
  if (existing) return existing.id;
  const held = await tx.applianceCustodyEpisode.findMany({
    where: { agreementId, endedOn: null }, select: { applianceId: true },
  });
  const job = await tx.job.create({ data: {
    type: "REMOVAL", status: "SCHEDULED", scheduledAt: null, agreementId,
    customerId: agreement.customerId, serviceAddressId: agreement.serviceAddressId,
    notes: "Rental is ending. Owner: choose a pickup date and time, and assign a technician.",
    appliances: { create: [...new Set(held.map((h) => h.applianceId))].map((applianceId) => ({ applianceId })) },
  } });
  return job.id;
}

/**
 * The owner chose "Pickup" for a fixed-term rental that is reaching its end date. Records the decision and creates
 * exactly one draft pickup visit; the rental ends on its own end date as before. Safe to repeat.
 */
export async function decideEndingPickup(actorId: string, agreementId: string): Promise<{ jobId: string; created: boolean }> {
  const { prisma } = await import("@/lib/prisma");
  const { assertActiveTeamActor } = await import("@/lib/team-actor");
  const { lockRentalAgreementInTx } = await import("./index");
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const agreement = await lockRentalAgreementInTx(tx, agreementId);
    if (agreement.status !== "ACTIVE") throw new Error("Only an active rental can be set to end.");
    if (!agreement.termMonths || !agreement.endDate) throw new Error("Only a fixed-term rental with an end date needs this decision.");
    if (agreement.terminationRequestedAt) throw new Error("An ending has already been set for this rental.");
    const renewal = await tx.rentalAgreement.findFirst({
      where: { renewedFromAgreementId: agreementId, status: { not: "CANCELLED" } }, select: { id: true },
    });
    if (renewal) throw new Error("This rental already has a renewal. Cancel the renewal first to end it instead.");
    const before = await tx.job.findFirst({ where: { agreementId, type: "REMOVAL", status: { not: "CANCELLED" } }, select: { id: true } });
    const jobId = await ensurePickupDraftInTx(tx, agreementId);
    if (!jobId) throw new Error("Could not create the pickup visit.");
    if (!before) {
      await tx.auditLog.create({ data: { userId: actorId, action: "agreement.ending_pickup_chosen", entityType: "RentalAgreement",
        entityId: agreementId, newValue: { pickupJobId: jobId } } });
    }
    return { jobId, created: !before };
  });
}
