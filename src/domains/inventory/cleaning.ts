import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { assertStatusChangeKeepsCustody } from "./custody";
import { canTransitionApplianceStatus } from "./lifecycle";

type Tx = Prisma.TransactionClient;

/**
 * W-17 (E3): a machine that passed inspection is cleaned before it can be rented again. "Cleaning done" is the only
 * step that makes it Available. Owner or admin; locks the appliance first; safe to repeat (a second press finds it already Available).
 */
export async function markCleaningDone(userId: string, applianceId: string): Promise<{ changed: boolean }> {
  return prisma.$transaction(async (tx: Tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ${applianceId} FOR UPDATE`;
    const appliance = await tx.appliance.findUniqueOrThrow({ where: { id: applianceId }, select: { status: true } });
    if (appliance.status === "AVAILABLE") return { changed: false };
    if (appliance.status !== "CLEANING") throw new Error("This appliance isn't being cleaned.");
    const check = canTransitionApplianceStatus("CLEANING", "AVAILABLE");
    if (!check.ok) throw new Error(check.reason);
    await assertStatusChangeKeepsCustody(tx, applianceId, "AVAILABLE");
    const moved = await tx.appliance.updateMany({ where: { id: applianceId, status: "CLEANING" }, data: { status: "AVAILABLE" } });
    if (moved.count !== 1) throw new Error("This appliance was just changed by someone else — refresh and try again.");
    await tx.auditLog.create({
      data: { userId, action: "appliance.unit.status", entityType: "Appliance", entityId: applianceId,
        oldValue: { status: "CLEANING" }, newValue: { status: "AVAILABLE", reason: "Cleaning done" } },
    });
    return { changed: true };
  });
}

/**
 * A failed inspection drafts one repair visit with no date for the owner to schedule. If an unfinished repair visit
 * already exists for this appliance it is reused, so the draft is never created twice. Nothing is sent or charged.
 */
export async function ensureRepairDraftInTx(tx: Tx, applianceId: string, reason: string): Promise<string> {
  const existing = await tx.job.findFirst({
    where: { type: "MAINTENANCE_VISIT", status: { in: ["SCHEDULED", "IN_PROGRESS"] }, appliances: { some: { applianceId } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true },
  });
  if (existing) return existing.id;
  const assignment = await tx.applianceAssignment.findFirst({
    where: { applianceId, unassignedAt: null },
    select: { rentalLine: { select: { agreementId: true, agreement: { select: { customerId: true, serviceAddressId: true } } } } },
  });
  const job = await tx.job.create({ data: {
    type: "MAINTENANCE_VISIT", status: "SCHEDULED", scheduledAt: null,
    customerId: assignment?.rentalLine.agreement.customerId ?? null,
    serviceAddressId: assignment?.rentalLine.agreement.serviceAddressId ?? null,
    agreementId: assignment?.rentalLine.agreementId ?? null,
    notes: reason, appliances: { create: [{ applianceId }] },
  } });
  return job.id;
}
