import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { lockRentalAgreementInTx } from "@/domains/agreements";
import { formatBusinessDate } from "@/lib/business-date";

// ---------------------------------------------------------------------------
// Items missing from the first delivery (Batch C section 8). An item that did not arrive stays on the agreement
// (and on the subscription) and the credit is the remedy. The owner can set aside a same-type unit to take its
// place on a later delivery visit. The waiting row is the single record of that: `substituteApplianceId` and
// `substituteJobId`. Nothing about money changes until the substitute is delivered.
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

export class SubstituteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubstituteError";
  }
}

/**
 * Owner or admin: set aside `replacementApplianceId` (same type, available) to take the place of a waiting item on
 * a scheduled or in-progress delivery visit for the same agreement. The replacement becomes reserved and joins the
 * visit as the `REPLACEMENT` unit. Lock order: agreement, job, appliances (sorted), the waiting row.
 */
export async function substituteWaitingItem(
  userId: string,
  input: { pendingDeliveryId: string; replacementApplianceId: string; deliveryJobId: string },
): Promise<void> {
  const peek = await prisma.pendingDelivery.findUnique({ where: { id: input.pendingDeliveryId }, select: { agreementId: true, applianceId: true } });
  if (!peek) throw new SubstituteError("Couldn't find that waiting item.");
  if (peek.applianceId === input.replacementApplianceId) throw new SubstituteError("Choose a different unit to take its place.");

  await prisma.$transaction(async (tx: Tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await lockRentalAgreementInTx(tx, peek.agreementId);
    await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${input.deliveryJobId} FOR UPDATE`;
    const job = await tx.job.findUnique({
      where: { id: input.deliveryJobId },
      select: { id: true, type: true, status: true, agreementId: true, appliances: { select: { applianceId: true } } },
    });
    if (!job || job.agreementId !== peek.agreementId) throw new SubstituteError("That visit isn't for this agreement.");
    if (job.type !== "DELIVERY" && job.type !== "INSTALLATION") throw new SubstituteError("Choose a delivery or installation visit.");
    if (job.status !== "SCHEDULED" && job.status !== "IN_PROGRESS") throw new SubstituteError("Choose a visit that is scheduled or in progress.");
    if (job.appliances.length === 0) throw new SubstituteError("That visit has no appliance list yet. Add the units it delivers first.");
    if (job.appliances.some((row) => row.applianceId === peek.applianceId)) {
      throw new SubstituteError("The waiting item is already on that visit. Deliver it, or take it off the visit first.");
    }

    const ids = [peek.applianceId, input.replacementApplianceId].sort();
    await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ANY(${ids}) ORDER BY "id" FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "PendingDelivery" WHERE "id" = ${input.pendingDeliveryId} FOR UPDATE`;
    const pending = await tx.pendingDelivery.findUniqueOrThrow({ where: { id: input.pendingDeliveryId } });
    if (pending.deliveredOn || pending.removedAt) throw new SubstituteError("That item was already delivered or taken off the agreement.");
    if (pending.substituteApplianceId) throw new SubstituteError("That item already has a unit set aside to replace it.");

    const [original, replacement] = await Promise.all([
      tx.appliance.findUniqueOrThrow({ where: { id: peek.applianceId }, select: { id: true, assetNumber: true, applianceTypeId: true, status: true } }),
      tx.appliance.findUnique({ where: { id: input.replacementApplianceId }, select: { id: true, assetNumber: true, applianceTypeId: true, status: true } }),
    ]);
    if (!replacement) throw new SubstituteError("Couldn't find that replacement unit.");
    if (original.status !== "RESERVED") throw new SubstituteError("The waiting item is no longer set aside for this customer.");
    if (replacement.applianceTypeId !== original.applianceTypeId) throw new SubstituteError("Different type: ask the owner.");
    if (replacement.status !== "AVAILABLE") throw new SubstituteError(`${replacement.assetNumber} isn't currently available.`);

    const reserved = await tx.appliance.updateMany({ where: { id: replacement.id, status: "AVAILABLE" }, data: { status: "RESERVED" } });
    if (reserved.count !== 1) throw new SubstituteError(`${replacement.assetNumber} was just taken by someone else.`);
    await tx.jobAppliance.create({ data: { jobId: job.id, applianceId: replacement.id, role: "REPLACEMENT", reservationActive: true } });
    await tx.pendingDelivery.update({ where: { id: pending.id }, data: { substituteApplianceId: replacement.id, substituteJobId: job.id } });
    await tx.auditLog.create({
      data: { userId, action: "appliance.unit.status", entityType: "Appliance", entityId: replacement.id, oldValue: { status: "AVAILABLE" }, newValue: { status: "RESERVED", reason: `Set aside to replace waiting ${original.assetNumber}`, jobId: job.id } },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "billing.item_substituted",
        entityType: "PendingDelivery",
        entityId: pending.id,
        newValue: { agreementId: pending.agreementId, waitingApplianceId: original.id, substituteApplianceId: replacement.id, jobId: job.id },
      },
    });
  });
}

/**
 * Inside `completeJob`, when a substitute is delivered: the waiting item's assignment ends ("Replaced by <asset>"),
 * the waiting unit goes back on the shelf, and the substitute takes its place on the same rental line. The credit
 * for the missing days is worked out afterwards by `recordLateDeliveries`, counted to the substitute's delivery date.
 * The caller has already locked the appliances involved and holds the agreement lock.
 */
export async function takeSubstituteIntoLineInTx(
  tx: Tx,
  input: { userId: string; jobId: string; substituteApplianceId: string; substituteAssetNumber: string; at: Date },
): Promise<boolean> {
  const pending = await tx.pendingDelivery.findFirst({
    where: { substituteApplianceId: input.substituteApplianceId, substituteJobId: input.jobId, deliveredOn: null, removedAt: null },
    select: { id: true, applianceId: true, rentalLineId: true, agreementId: true },
  });
  if (!pending) return false;
  await tx.$queryRaw`SELECT "id" FROM "PendingDelivery" WHERE "id" = ${pending.id} FOR UPDATE`;
  const original = await tx.appliance.findUniqueOrThrow({ where: { id: pending.applianceId }, select: { assetNumber: true, status: true } });
  const openOriginal = await tx.applianceAssignment.findFirst({
    where: { applianceId: pending.applianceId, unassignedAt: null, rentalLine: { agreementId: pending.agreementId } },
    select: { id: true },
  });
  if (openOriginal) {
    await tx.applianceAssignment.update({
      where: { id: openOriginal.id },
      data: { unassignedAt: input.at, unassignReason: `Replaced by ${input.substituteAssetNumber}` },
    });
  }
  const released = await tx.appliance.updateMany({ where: { id: pending.applianceId, status: "RESERVED" }, data: { status: "AVAILABLE" } });
  if (released.count === 1) {
    await tx.auditLog.create({
      data: { userId: input.userId, action: "appliance.unit.status", entityType: "Appliance", entityId: pending.applianceId, oldValue: { status: "RESERVED" }, newValue: { status: "AVAILABLE", reason: `Replaced by ${input.substituteAssetNumber}`, jobId: input.jobId } },
    });
  }
  const already = await tx.applianceAssignment.findFirst({ where: { applianceId: input.substituteApplianceId, unassignedAt: null }, select: { id: true } });
  if (!already) {
    await tx.applianceAssignment.create({ data: { rentalLineId: pending.rentalLineId, applianceId: input.substituteApplianceId } });
  }
  await tx.jobAppliance.updateMany({ where: { jobId: input.jobId, applianceId: input.substituteApplianceId }, data: { reservationActive: false } });
  await tx.auditLog.create({
    data: { userId: input.userId, action: "billing.item_replaced", entityType: "PendingDelivery", entityId: pending.id, newValue: { waitingApplianceId: pending.applianceId, waitingAsset: original.assetNumber, substituteApplianceId: input.substituteApplianceId, jobId: input.jobId } },
  });
  return true;
}

/** The substitute was not delivered on this visit: it goes back on the shelf and the item is waiting for its own unit again. */
export async function dropSubstituteInTx(
  tx: Tx,
  input: { userId: string; jobId: string; substituteApplianceId: string },
): Promise<boolean> {
  const pending = await tx.pendingDelivery.findFirst({
    where: { substituteApplianceId: input.substituteApplianceId, substituteJobId: input.jobId, deliveredOn: null, removedAt: null },
    select: { id: true },
  });
  if (!pending) return false;
  await tx.$queryRaw`SELECT "id" FROM "PendingDelivery" WHERE "id" = ${pending.id} FOR UPDATE`;
  const released = await tx.appliance.updateMany({ where: { id: input.substituteApplianceId, status: "RESERVED" }, data: { status: "AVAILABLE" } });
  if (released.count === 1) {
    await tx.auditLog.create({
      data: { userId: input.userId, action: "appliance.unit.status", entityType: "Appliance", entityId: input.substituteApplianceId, oldValue: { status: "RESERVED" }, newValue: { status: "AVAILABLE", reason: "Substitute was not delivered", jobId: input.jobId } },
    });
  }
  await tx.jobAppliance.updateMany({ where: { jobId: input.jobId, applianceId: input.substituteApplianceId }, data: { reservationActive: false } });
  await tx.pendingDelivery.update({ where: { id: pending.id }, data: { substituteApplianceId: null, substituteJobId: null } });
  return true;
}

/** What the owner can pick from when setting a unit aside for a waiting item: same-type available units and open delivery visits. */
export async function substituteChoices(pendingDeliveryId: string): Promise<{
  units: Array<{ id: string; label: string }>;
  visits: Array<{ id: string; label: string }>;
}> {
  const pending = await prisma.pendingDelivery.findUnique({
    where: { id: pendingDeliveryId },
    select: { agreementId: true, applianceId: true, deliveredOn: true, removedAt: true, substituteApplianceId: true, appliance: { select: { applianceTypeId: true } } },
  });
  if (!pending || pending.deliveredOn || pending.removedAt || pending.substituteApplianceId) return { units: [], visits: [] };
  const [units, visits] = await Promise.all([
    prisma.appliance.findMany({
      where: { applianceTypeId: pending.appliance.applianceTypeId, status: "AVAILABLE", id: { not: pending.applianceId } },
      orderBy: { assetNumber: "asc" },
      take: 25,
      select: { id: true, assetNumber: true },
    }),
    prisma.job.findMany({
      where: {
        agreementId: pending.agreementId,
        type: { in: ["DELIVERY", "INSTALLATION"] },
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        appliances: { some: {}, none: { applianceId: pending.applianceId } },
      },
      orderBy: { scheduledAt: "asc" },
      take: 10,
      select: { id: true, type: true, scheduledAt: true },
    }),
  ]);
  return {
    units: units.map((u) => ({ id: u.id, label: `#${u.assetNumber}` })),
    visits: visits.map((v) => ({ id: v.id, label: `${v.type === "INSTALLATION" ? "Installation" : "Delivery"}${v.scheduledAt ? ` on ${formatBusinessDate(v.scheduledAt)}` : " (not scheduled yet)"}` })),
  };
}
