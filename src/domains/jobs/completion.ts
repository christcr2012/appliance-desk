import type { JobApplianceResult, JobApplianceRole, JobOutcome, JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor, type TeamRole } from "@/lib/team-actor";
import { assertJobScopeInTx } from "./scope";
import { dropSubstituteInTx, takeSubstituteIntoLineInTx } from "./substitution";
import { businessDateKey, businessDayBounds } from "@/lib/business-date";
import { lockCustomerLedger } from "@/domains/billing/ledger";
import { lockRentalAgreementInTx, runCloseAgreementContinuation } from "@/domains/agreements";
import { closeIfFullyReturnedInTx, type ReturnCloseOutcome } from "@/domains/agreements/returns";
import { runEarlyReturnContinuation } from "@/domains/agreements/early-return";
import { startRecurringBillingForAgreement } from "@/domains/billing/checkout";
import { pushLateDeliveryCreditForHandoff } from "@/domains/billing/handoff-adapters";
import { PROVIDER_OPERATION_LEASE_MS } from "@/domains/billing/provider-ops";
import {
  jobServiceDate,
  recordItemsNotDelivered,
  recordLateDeliveries,
  recordLateReturnOnRemoval,
  type PickupBillingOutcome,
} from "@/domains/billing/pickup-billing-events";
import { closeCustodyEpisodeInTx, getOpenCustody, openCustodyEpisodeInTx } from "@/domains/inventory/custody";
import { createTaskInTx } from "@/domains/tasks";
import { lockMaintenanceRequestInTx, requestAfterVisitEndedInTx } from "@/domains/maintenance/visit-sync";
import { JobVersionError } from "./scheduling";

// ---------------------------------------------------------------------------
// Completing a job (Batch C, slice P2-B). Every appliance in the job's scope gets exactly one result.
// Positive results move the unit (and open or close its custody); negative results move nothing and
// create one follow-up task. The billing work that completion already did stays in this transaction;
// the provider calls that must follow the commit are written as JobBillingHandoff rows in the same
// transaction and run afterwards (and again by the nightly sweep if the process died).
// Lock order (spec section 0): actor, customer (when the job has an agreement), agreement(s),
// maintenance request, job, appliances sorted.
// ---------------------------------------------------------------------------

export class JobCompletionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobCompletionConflictError";
  }
}

export type JobApplianceResultInput = { applianceId: string; result: JobApplianceResult; note?: string };

export type CompleteJobInput = {
  jobId: string;
  expectedVersion: number;
  /** A random id the screen makes when the form opens; a retry with the same id returns the first result. */
  completionKey: string;
  /** Colorado-midnight date the work was done; null = today. */
  performedOn: Date | null;
  completionNotes: string | null;
  results: readonly JobApplianceResultInput[];
};

export type CompleteJobResult = {
  jobId: string;
  outcome: JobOutcome;
  replayed: boolean;
  followUpTaskIds: string[];
  handoffIds: string[];
  /** Set when this completion decided what to do about a fully returned rental (not stored; replays leave it empty). */
  returnClose?: ReturnCloseOutcome | null;
};

const COMPLETION_KEY_PATTERN = /^[A-Za-z0-9:_-]{8,100}$/;
const POSITIVE: ReadonlySet<JobApplianceResult> = new Set(["DELIVERED", "RETURNED", "REPAIRED"]);

/** Which results a unit may be given, by job type and the unit's role in the job. */
export function allowedResults(type: JobType, role: JobApplianceRole): readonly JobApplianceResult[] {
  switch (type) {
    case "DELIVERY":
    case "INSTALLATION":
      return ["DELIVERED", "NOT_DELIVERED"];
    case "REMOVAL":
      return ["RETURNED", "NOT_RETURNED"];
    case "MAINTENANCE_VISIT":
      return ["REPAIRED", "NOT_REPAIRED", "NO_ACCESS"];
    case "SWAP":
      return role === "REPLACEMENT" ? ["DELIVERED", "NOT_DELIVERED"] : ["RETURNED", "NOT_RETURNED"];
  }
}

/** The result that is pre-selected on the form for each unit. */
export function positiveResultFor(type: JobType, role: JobApplianceRole): JobApplianceResult {
  return allowedResults(type, role)[0];
}

function taskNote(result: JobApplianceResult, label: string, customerName: string | null): string {
  const who = customerName ? ` (${customerName})` : "";
  switch (result) {
    case "NOT_DELIVERED":
      return `Deliver ${label}${who}: it was not delivered on the visit.`;
    case "NOT_RETURNED":
      return `Collect ${label}${who}: it was not picked up.`;
    case "NOT_REPAIRED":
      return `Repair of ${label}${who} was not finished. Reschedule it.`;
    case "NO_ACCESS":
      return `Couldn't get to ${label}${who}. Reschedule the visit.`;
    default:
      return `Follow up on ${label}${who}.`;
  }
}

async function lockRows(tx: Prisma.TransactionClient, table: "MaintenanceRequest" | "Job", id: string) {
  const rows =
    table === "Job"
      ? await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Job" WHERE "id" = ${id} FOR UPDATE`
      : await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "MaintenanceRequest" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length !== 1) throw new Error(table === "Job" ? "Couldn't find that job." : "Couldn't find that maintenance request.");
}

async function replayResult(tx: Prisma.TransactionClient, jobId: string, outcome: JobOutcome): Promise<CompleteJobResult> {
  const [tasks, handoffs] = await Promise.all([
    tx.staffTask.findMany({ where: { sourceKey: { startsWith: `job:${jobId}:` } }, select: { id: true }, orderBy: { id: "asc" } }),
    tx.jobBillingHandoff.findMany({ where: { jobId }, select: { id: true }, orderBy: { id: "asc" } }),
  ]);
  return { jobId, outcome, replayed: true, followUpTaskIds: tasks.map((t) => t.id), handoffIds: handoffs.map((h) => h.id) };
}

export async function completeJob(userId: string, input: CompleteJobInput): Promise<CompleteJobResult> {
  if (!COMPLETION_KEY_PATTERN.test(input.completionKey)) {
    throw new Error("This request has no valid identity. Reload the page and try again.");
  }
  const seen = new Set<string>();
  for (const r of input.results) {
    if (seen.has(r.applianceId)) throw new Error("Each appliance can have only one result.");
    seen.add(r.applianceId);
  }
  const now = new Date();
  if (input.performedOn && businessDateKey(input.performedOn) > businessDateKey(now)) {
    throw new Error("The date the work was done cannot be in the future.");
  }
  const completionNotes = input.completionNotes?.trim() ? input.completionNotes.trim().slice(0, 2000) : null;

  const peek = await prisma.job.findUnique({
    where: { id: input.jobId },
    select: { agreementId: true, maintenanceRequestId: true, agreement: { select: { customerId: true } } },
  });
  if (!peek) throw new Error("Couldn't find that job.");

  const outcome = await prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, userId);
    await assertJobScopeInTx(tx, { userId, role: actor.role as TeamRole }, { jobId: input.jobId, write: "COMPLETE" });
    if (peek.agreement) await lockCustomerLedger(tx, peek.agreement.customerId);
    if (peek.agreementId) await lockRentalAgreementInTx(tx, peek.agreementId);
    if (peek.maintenanceRequestId) await lockMaintenanceRequestInTx(tx, peek.maintenanceRequestId);
    await lockRows(tx, "Job", input.jobId);

    const before = await tx.job.findUniqueOrThrow({
      where: { id: input.jobId },
      include: { customer: { select: { id: true, user: { select: { name: true, email: true } } } } },
    });

    if (before.status === "COMPLETED") {
      if (before.completionKey === input.completionKey && before.outcome) return replayResult(tx, before.id, before.outcome);
      throw new JobCompletionConflictError("This job was already completed.");
    }
    if (before.status !== "IN_PROGRESS") {
      throw new JobCompletionConflictError(
        before.status === "CANCELLED" ? "A cancelled job can't be completed." : "Start the job before completing it.",
      );
    }
    if (before.version !== input.expectedVersion) throw new JobVersionError();

    // --- scope: the appliances this visit covers -------------------------------------------------
    let scope = await tx.jobAppliance.findMany({ where: { jobId: before.id }, select: { applianceId: true, role: true } });
    let derived = false;
    if (scope.length === 0 && before.agreementId) {
      if (before.type === "DELIVERY" || before.type === "INSTALLATION") {
        const rows = await tx.applianceAssignment.findMany({
          where: { unassignedAt: null, rentalLine: { agreementId: before.agreementId }, appliance: { status: "RESERVED" } },
          select: { applianceId: true },
        });
        scope = [...new Set(rows.map((r) => r.applianceId))].map((applianceId) => ({ applianceId, role: "PRIMARY" as const }));
        derived = true;
      } else if (before.type === "REMOVAL") {
        const rows = await tx.applianceAssignment.findMany({
          where: { rentalLine: { agreementId: before.agreementId }, appliance: { status: "AWAITING_PICKUP" } },
          select: { applianceId: true },
        });
        scope = [...new Set(rows.map((r) => r.applianceId))].map((applianceId) => ({ applianceId, role: "PRIMARY" as const }));
        derived = true;
      }
    }
    const scopeIds = scope.map((s) => s.applianceId).sort();

    // A SWAP is allowed to survive renewal. Resolve its outgoing unit's current
    // rental lineage while the staged agreement is locked, then lock that current
    // agreement before any appliance row. This preserves Agreement -> Appliance
    // ordering against close/renewal commands and prevents a deadlock cycle.
    let prelockedSwapAgreementId: string | null = null;
    if (before.type === "SWAP") {
      const originalId = scope.find((s) => s.role === "PRIMARY")?.applianceId ?? null;
      if (originalId) {
        const currentAssignment = await tx.applianceAssignment.findFirst({
          where: { applianceId: originalId, unassignedAt: null },
          select: { rentalLine: { select: { agreementId: true } } },
        });
        prelockedSwapAgreementId = currentAssignment?.rentalLine.agreementId ?? null;
        if (prelockedSwapAgreementId && prelockedSwapAgreementId !== before.agreementId) {
          await lockRentalAgreementInTx(tx, prelockedSwapAgreementId);
        }
      }
    }

    const substitutions =
      before.agreementId && (before.type === "DELIVERY" || before.type === "INSTALLATION")
        ? await tx.pendingDelivery.findMany({
            where: { substituteJobId: before.id, deliveredOn: null, removedAt: null },
            select: { id: true, applianceId: true, substituteApplianceId: true },
          })
        : [];
    const substituteIds = new Set(substitutions.map((s) => s.substituteApplianceId).filter((id): id is string => id !== null));
    const lockIds = [...new Set([...scopeIds, ...substitutions.map((s) => s.applianceId)])].sort();
    if (lockIds.length > 0) {
      await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ANY(${lockIds}) ORDER BY "id" FOR UPDATE`;
    }
    const droppedSubstituteIds = new Set<string>();

    // --- every appliance in scope gets exactly one valid result ----------------------------------
    const roleOf = new Map(scope.map((s) => [s.applianceId, s.role]));
    const resultOf = new Map(input.results.map((r) => [r.applianceId, r]));
    const missing = scopeIds.filter((id) => !resultOf.has(id));
    const extra = input.results.filter((r) => !roleOf.has(r.applianceId));
    if (extra.length > 0) throw new JobCompletionConflictError("A result was given for an appliance that is not part of this job.");
    if (missing.length > 0) throw new JobCompletionConflictError("Every appliance on this visit needs a result before the job can be completed.");
    for (const id of scopeIds) {
      const given = resultOf.get(id)!.result;
      if (!allowedResults(before.type, roleOf.get(id)!).includes(given)) {
        throw new JobCompletionConflictError("That result doesn't fit this kind of visit.");
      }
    }
    if (before.type === "SWAP") {
      const returned = scope.some((s) => s.role === "PRIMARY" && resultOf.get(s.applianceId)!.result === "RETURNED");
      const notDeliveredNew = scope.some((s) => s.role === "REPLACEMENT" && resultOf.get(s.applianceId)!.result === "NOT_DELIVERED");
      if (returned && notDeliveredNew) {
        throw new JobCompletionConflictError("Don't take the old unit unless the new one is delivered.");
      }
    }
    const isDelivery = before.type === "DELIVERY" || before.type === "INSTALLATION";
    const notDeliveredIds = scopeIds.filter((id) => resultOf.get(id)!.result === "NOT_DELIVERED");
    if (isDelivery && notDeliveredIds.length > 0 && !before.agreementId) {
      throw new JobCompletionConflictError("Only a delivery or installation job for a rental agreement can have items marked not delivered.");
    }

    // --- times ------------------------------------------------------------------------------------
    const completedAt = now;
    const performedOn = input.performedOn ?? before.performedOn ?? businessDayBounds(completedAt).start;
    const serviceDate = jobServiceDate({ performedOn, scheduledAt: before.scheduledAt, completedAt });
    const deliveredIds = scopeIds.filter((id) => resultOf.get(id)!.result === "DELIVERED");

    // The first successful physical delivery is the immutable business fact that anchors billing.
    // Zero-delivery visits deliberately leave it null and therefore cannot start recurring billing.
    if (isDelivery && before.agreementId && deliveredIds.length > 0) {
      // A brand-new rental (not a renewal) starts its continuous history on its first delivery.
      await tx.rentalAgreement.updateMany({
        where: { id: before.agreementId, firstDeliveredOn: null, renewedFromAgreementId: null, continuityRootId: null },
        data: { continuityRootId: before.agreementId, continuousSince: serviceDate },
      });
      await tx.rentalAgreement.updateMany({
        where: { id: before.agreementId, firstDeliveredOn: null },
        data: { firstDeliveredOn: serviceDate },
      });
    }

    if (derived) {
      await tx.jobAppliance.createMany({ data: scopeIds.map((applianceId) => ({ jobId: before.id, applianceId })), skipDuplicates: true });
    }

    // --- per-appliance effects, in id order ------------------------------------------------------
    const appliances = await tx.appliance.findMany({
      where: { id: { in: scopeIds } },
      select: { id: true, status: true, assetNumber: true, applianceType: { select: { name: true } } },
    });
    const applianceById = new Map(appliances.map((a) => [a.id, a]));
    const customerId = before.customerId ?? peek.agreement?.customerId ?? null;
    const customerName = before.customer?.user.name ?? before.customer?.user.email ?? null;
    const positiveIds: string[] = [];
    const notes: string[] = [];

    for (const applianceId of scopeIds) {
      const appliance = applianceById.get(applianceId)!;
      const result = resultOf.get(applianceId)!;

      if (result.result === "NOT_DELIVERED" && isDelivery) {
        if (appliance.status !== "RESERVED") {
          throw new JobCompletionConflictError("An item marked not delivered is not waiting for delivery (it was already delivered or released).");
        }
        if (substituteIds.has(applianceId) && (await dropSubstituteInTx(tx, { userId, jobId: before.id, substituteApplianceId: applianceId }))) {
          droppedSubstituteIds.add(applianceId);
        }
      }

      if (result.result === "DELIVERED") {
        if (!customerId) {
          throw new JobCompletionConflictError(`${appliance.assetNumber} can't be marked delivered on a visit with no customer. Open the job, choose the customer, then complete it.`);
        }
        if (isDelivery) {
          if (before.agreementId) {
            if (substituteIds.has(applianceId)) {
              await takeSubstituteIntoLineInTx(tx, { userId, jobId: before.id, substituteApplianceId: applianceId, substituteAssetNumber: appliance.assetNumber, at: completedAt });
            }
            const assigned = await tx.applianceAssignment.findFirst({ where: { applianceId, unassignedAt: null, rentalLine: { agreementId: before.agreementId } }, select: { id: true } });
            if (!assigned) throw new JobCompletionConflictError(`${appliance.assetNumber} is not set aside for this customer's agreement, so it can't be marked delivered on this visit.`);
          }
          const moved = await tx.appliance.updateMany({ where: { id: applianceId, status: "RESERVED" }, data: { status: "RENTED" } });
          if (moved.count !== 1) throw new JobCompletionConflictError(`${appliance.assetNumber} is no longer waiting for delivery, so it can't be marked delivered.`);
          await tx.auditLog.create({
            data: { userId, action: "appliance.unit.status", entityType: "Appliance", entityId: applianceId, oldValue: { status: "RESERVED" }, newValue: { status: "RENTED", reason: `Job ${before.type.toLowerCase()} completed`, jobId: before.id } },
          });
        }
        if (before.type !== "SWAP") {
          await openCustodyEpisodeInTx(tx, { applianceId, customerId, serviceAddressId: before.serviceAddressId, agreementId: before.agreementId, startedOn: serviceDate, startJobId: before.id });
        }
        positiveIds.push(applianceId);
      } else if (result.result === "RETURNED") {
        const holder = await getOpenCustody(tx, applianceId);
        if (holder && holder.customerId !== customerId) {
          throw new JobCompletionConflictError(`${appliance.assetNumber} is recorded as being with a different customer, so it can't be returned on this visit.`);
        }
        if (before.type === "REMOVAL") {
          if (before.agreementId) {
            const currentAssignment = await tx.applianceAssignment.findFirst({
              where: { applianceId, unassignedAt: null },
              select: { rentalLine: { select: { agreementId: true } } },
            });
            if (currentAssignment && currentAssignment.rentalLine.agreementId !== before.agreementId) {
              throw new JobCompletionConflictError(
                `${appliance.assetNumber} now belongs to a newer rental agreement. Resolve this old removal job before changing custody.`,
              );
            }
          }
          const moved = await tx.appliance.updateMany({ where: { id: applianceId, status: { in: ["AWAITING_PICKUP", "RENTED"] } }, data: { status: "AWAITING_INSPECTION" } });
          if (moved.count !== 1) throw new JobCompletionConflictError(`${appliance.assetNumber} isn't out with a customer, so it can't be marked returned.`);
          await tx.auditLog.create({
            data: { userId, action: "appliance.unit.status", entityType: "Appliance", entityId: applianceId, oldValue: { status: appliance.status }, newValue: { status: "AWAITING_INSPECTION", reason: `Job ${before.type.toLowerCase()} completed`, jobId: before.id } },
          });
          await closeCustodyEpisodeInTx(tx, { applianceId, endedOn: serviceDate, endJobId: before.id, endReason: "Returned" });
        }
        positiveIds.push(applianceId);
      } else if (result.result === "REPAIRED") {
        positiveIds.push(applianceId);
      }

      await tx.jobAppliance.updateMany({
        where: { jobId: before.id, applianceId },
        data: {
          result: result.result,
          resultNote: result.note?.trim() ? result.note.trim().slice(0, 500) : null,
          resultRecordedAt: completedAt,
          resultRecordedByUserId: userId,
        },
      });
    }

    // --- swap: both units, both custody records and the assignment move together ----------------
    let swapBothNegative = false;
    if (before.type === "SWAP") {
      const originalId = scope.find((s) => s.role === "PRIMARY")?.applianceId ?? null;
      const replacementId = scope.find((s) => s.role === "REPLACEMENT")?.applianceId ?? null;
      const originalResult = originalId ? resultOf.get(originalId)!.result : null;
      const replacementResult = replacementId ? resultOf.get(replacementId)!.result : null;
      swapBothNegative = originalResult === "NOT_RETURNED" && replacementResult === "NOT_DELIVERED";
      const reservationOwned = replacementId
        ? (await tx.jobAppliance.findFirst({ where: { jobId: before.id, applianceId: replacementId, reservationActive: true }, select: { id: true } })) !== null
        : false;
      if (replacementId && replacementResult === "DELIVERED") {
        const replacement = applianceById.get(replacementId)!;
        const original = originalId ? applianceById.get(originalId)! : null;
        const originalAssignment = originalId
          ? await tx.applianceAssignment.findFirst({
              where: { applianceId: originalId, unassignedAt: null },
              select: {
                id: true,
                rentalLineId: true,
                rentalLine: {
                  select: {
                    agreementId: true,
                    agreement: { select: { customerId: true, serviceAddressId: true } },
                  },
                },
              },
            })
          : null;
        if (!originalAssignment) {
          throw new JobCompletionConflictError("The appliance being swapped no longer has a current rental assignment. Reload and resolve the agreement before completing this swap.");
        }
        if (
          originalAssignment.rentalLine.agreementId !== before.agreementId &&
          originalAssignment.rentalLine.agreementId !== prelockedSwapAgreementId
        ) {
          throw new JobCompletionConflictError(
            "The appliance's rental agreement changed while this swap was being completed. Reload the job and try again.",
          );
        }
        const currentAgreement = originalAssignment.rentalLine.agreement;
        if (currentAgreement.customerId !== customerId || currentAgreement.serviceAddressId !== before.serviceAddressId) {
          throw new JobCompletionConflictError("This swap's current rental agreement no longer matches the customer and property on the staged visit.");
        }
        const replacementAssignment = await tx.applianceAssignment.findFirst({
          where: { applianceId: replacementId, unassignedAt: null },
          select: { id: true, rentalLineId: true },
        });
        if (replacementAssignment && replacementAssignment.rentalLineId !== originalAssignment.rentalLineId) {
          throw new JobCompletionConflictError(`${replacement.assetNumber} is already assigned to a different rental line, so the swap can't be completed.`);
        }
        const moved = await tx.appliance.updateMany({ where: { id: replacementId, status: "RESERVED" }, data: { status: "RENTED" } });
        if (moved.count !== 1) throw new JobCompletionConflictError(`${replacement.assetNumber} is no longer waiting for delivery, so the swap can't be completed.`);
        await tx.auditLog.create({
          data: { userId, action: "appliance.unit.status", entityType: "Appliance", entityId: replacementId, oldValue: { status: "RESERVED" }, newValue: { status: "RENTED", reason: "Swap completed", jobId: before.id } },
        });
        await openCustodyEpisodeInTx(tx, {
          applianceId: replacementId,
          customerId: currentAgreement.customerId,
          serviceAddressId: currentAgreement.serviceAddressId,
          agreementId: originalAssignment.rentalLine.agreementId,
          startedOn: serviceDate,
          startJobId: before.id,
        });
        await tx.applianceAssignment.update({
          where: { id: originalAssignment.id },
          data: { unassignedAt: completedAt, unassignReason: `Swapped for ${replacement.assetNumber}` },
        });
        if (!replacementAssignment) {
          await tx.applianceAssignment.create({ data: { rentalLineId: originalAssignment.rentalLineId, applianceId: replacementId } });
        }
        if (original && originalResult === "RETURNED") {
          if (await getOpenCustody(tx, originalId!)) {
            await closeCustodyEpisodeInTx(tx, { applianceId: originalId!, endedOn: serviceDate, endJobId: before.id, endReason: "Swapped out" });
          }
          const toInspection = await tx.appliance.updateMany({ where: { id: originalId!, status: { in: ["RENTED", "AWAITING_PICKUP", "MAINTENANCE"] } }, data: { status: "AWAITING_INSPECTION" } });
          if (toInspection.count === 1) {
            await tx.auditLog.create({
              data: { userId, action: "appliance.unit.status", entityType: "Appliance", entityId: originalId!, oldValue: { status: original.status }, newValue: { status: "AWAITING_INSPECTION", reason: "Swapped out", jobId: before.id } },
            });
          }
        }
        await tx.jobAppliance.updateMany({ where: { jobId: before.id, applianceId: replacementId }, data: { reservationActive: false } });
      } else if (!replacementId && originalId && originalResult === "RETURNED" && (await getOpenCustody(tx, originalId))) {
        await closeCustodyEpisodeInTx(tx, { applianceId: originalId, endedOn: serviceDate, endJobId: before.id, endReason: "Swapped out" });
      } else if (replacementId && swapBothNegative && reservationOwned) {
        const released = await tx.appliance.updateMany({ where: { id: replacementId, status: "RESERVED" }, data: { status: "AVAILABLE" } });
        if (released.count === 1) {
          await tx.auditLog.create({
            data: { userId, action: "appliance.unit.status", entityType: "Appliance", entityId: replacementId, oldValue: { status: "RESERVED" }, newValue: { status: "AVAILABLE", reason: "Swap did not happen", jobId: before.id } },
          });
        }
        await tx.jobAppliance.updateMany({ where: { jobId: before.id, applianceId: replacementId }, data: { reservationActive: false } });
      }
    }

    // --- billing that completion already did (same transaction) ----------------------------------
    const billing: PickupBillingOutcome[] = [];
    const returnedIds = scopeIds.filter((id) => resultOf.get(id)!.result === "RETURNED");
    if (before.agreementId && before.type === "REMOVAL") {
      billing.push(await recordLateReturnOnRemoval(tx, { userId, jobId: before.id, agreementId: before.agreementId, applianceIds: returnedIds, pickupDate: serviceDate }));
    }
    if (before.agreementId && isDelivery) {
      billing.push(await recordLateDeliveries(tx, { userId, jobId: before.id, agreementId: before.agreementId, applianceIds: deliveredIds, deliveryDate: serviceDate }));
      billing.push(await recordItemsNotDelivered(tx, { userId, jobId: before.id, agreementId: before.agreementId, applianceIds: notDeliveredIds, deliveryDate: serviceDate }));
    }
    // Everything is back and the agreed ending has arrived: close the rental now, so billing stops with it.
    let returnClose: ReturnCloseOutcome | null = null;
    if (before.agreementId && before.type === "REMOVAL" && returnedIds.length > 0) {
      returnClose = await closeIfFullyReturnedInTx(tx, userId, {
        agreementId: before.agreementId,
        jobId: before.id,
        pickupDate: serviceDate,
        taskActor: { userId: actor.id, role: actor.role as "OWNER" | "ADMIN" | "STAFF" },
      });
    }
    const billingNotes = billing.flatMap((b) => b.notes);
    if (billingNotes.length > 0) {
      await tx.auditLog.create({
        data: {
          userId,
          action: "job.pickup_billing",
          entityType: "Job",
          entityId: before.id,
          newValue: {
            agreementId: before.agreementId,
            serviceDate: serviceDate.toISOString(),
            lateReturnInvoiceId: billing.map((b) => b.lateReturnInvoiceId).find(Boolean) ?? null,
            creditIds: billing.flatMap((b) => b.creditIds),
            pendingDeliveryIds: billing.flatMap((b) => b.pendingDeliveryIds),
            notes: billingNotes,
          },
        },
      });
    }

    // --- follow-up tasks for every negative result ------------------------------------------------
    const followUpTaskIds: string[] = [];
    if (swapBothNegative) {
      const { task } = await createTaskInTx(
        tx,
        { userId: actor.id, role: actor.role as "OWNER" | "ADMIN" | "STAFF" },
        {
          note: `Reschedule the swap${customerName ? ` (${customerName})` : ""}: neither the new unit was delivered nor the old one collected.`,
          priority: "HIGH",
          jobId: before.id,
          customerId: customerId ?? null,
          sourceKey: `job:${before.id}:swap:reschedule`,
        },
      );
      followUpTaskIds.push(task.id);
    }
    for (const applianceId of scopeIds) {
      const given = resultOf.get(applianceId)!.result;
      if (POSITIVE.has(given)) continue;
      if (swapBothNegative) continue;
      if (droppedSubstituteIds.has(applianceId)) continue;
      const appliance = applianceById.get(applianceId)!;
      const { task } = await createTaskInTx(
        tx,
        { userId: actor.id, role: actor.role as "OWNER" | "ADMIN" | "STAFF" },
        {
          note: taskNote(given, `${appliance.applianceType.name} ${appliance.assetNumber}`, customerName),
          priority: "HIGH",
          jobId: before.id,
          customerId: customerId ?? null,
          applianceId,
          sourceKey: `job:${before.id}:${applianceId}:${given}`,
        },
      );
      followUpTaskIds.push(task.id);
    }

    // --- durable handoffs for the provider work that follows the commit ---------------------------
    const handoffRows: Array<{ jobId: string; kind: "START_RECURRING_BILLING" | "PUSH_CREDIT"; subjectId: string }> = [];
    if (isDelivery && before.agreementId && deliveredIds.length > 0) {
      handoffRows.push({ jobId: before.id, kind: "START_RECURRING_BILLING", subjectId: before.agreementId });
    }
    for (const creditId of billing.flatMap((b) => b.creditIds)) handoffRows.push({ jobId: before.id, kind: "PUSH_CREDIT", subjectId: creditId });
    if (handoffRows.length > 0) await tx.jobBillingHandoff.createMany({ data: handoffRows, skipDuplicates: true });
    const handoffs = await tx.jobBillingHandoff.findMany({ where: { jobId: before.id }, select: { id: true }, orderBy: { id: "asc" } });

    // --- the job itself ----------------------------------------------------------------------------
    const allPositive = scopeIds.every((id) => POSITIVE.has(resultOf.get(id)!.result));
    const jobOutcome: JobOutcome = allPositive ? "COMPLETE" : "PARTIAL";
    const updated = await tx.job.updateMany({
      where: { id: before.id, status: "IN_PROGRESS", version: before.version },
      data: {
        status: "COMPLETED",
        completedAt,
        performedOn,
        completionNotes: completionNotes ?? before.completionNotes,
        outcome: jobOutcome,
        completionKey: input.completionKey,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new JobVersionError();
    if (before.maintenanceRequestId && before.type === "MAINTENANCE_VISIT") {
      await requestAfterVisitEndedInTx(tx, userId, before.maintenanceRequestId, before.id, jobOutcome === "COMPLETE" ? "REPAIRED" : "NOT_FINISHED");
    }

    await tx.auditLog.create({
      data: { userId, action: "job.status", entityType: "Job", entityId: before.id, oldValue: { status: before.status }, newValue: { status: "COMPLETED", performedOn: performedOn.toISOString() } },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "job.complete",
        entityType: "Job",
        entityId: before.id,
        newValue: {
          outcome: jobOutcome,
          results: scopeIds.map((id) => ({ applianceId: id, result: resultOf.get(id)!.result })),
          followUpTaskIds,
          handoffIds: handoffs.map((h) => h.id),
          ...(notes.length > 0 ? { notes } : {}),
        },
      },
    });

    return { jobId: before.id, outcome: jobOutcome, replayed: false, followUpTaskIds, handoffIds: handoffs.map((h) => h.id), returnClose };
  });

  // The Stripe half of closing the rental runs only after the transaction commits.
  if (outcome.returnClose?.outcome === "CLOSED") await runCloseAgreementContinuation(outcome.returnClose.close);
  if (outcome.returnClose?.outcome === "EARLY_RETURN" && outcome.returnClose.applied) {
    await runEarlyReturnContinuation(userId, outcome.returnClose.applied);
  }
  if (!outcome.replayed && outcome.handoffIds.length > 0) await runHandoffs({ ids: outcome.handoffIds });
  const { returnClose: _returnClose, ...result } = outcome;
  void _returnClose;
  return result;
}

export type CompletionScopeRow = {
  applianceId: string;
  label: string;
  role: JobApplianceRole;
  allowed: JobApplianceResult[];
  defaultResult: JobApplianceResult;
};

/**
 * The appliances a job's completion form must collect a result for, with the results each may take.
 * Same scope as `completeJob`: the appliances listed on the job, or, when none are listed, the units
 * still waiting for delivery (delivery/installation) or awaiting pickup (removal) under its agreement.
 */
export async function getJobCompletionScope(job: {
  id: string;
  type: JobType;
  status: string;
  agreementId: string | null;
}): Promise<CompletionScopeRow[]> {
  if (job.status !== "IN_PROGRESS") return [];
  const select = { id: true, assetNumber: true, applianceType: { select: { name: true } } } as const;
  const listed = await prisma.jobAppliance.findMany({
    where: { jobId: job.id },
    select: { role: true, appliance: { select } },
    orderBy: { applianceId: "asc" },
  });
  let rows = listed.map((r) => ({ role: r.role, appliance: r.appliance }));
  if (rows.length === 0 && job.agreementId) {
    if (job.type === "DELIVERY" || job.type === "INSTALLATION") {
      const found = await prisma.applianceAssignment.findMany({
        where: { unassignedAt: null, rentalLine: { agreementId: job.agreementId }, appliance: { status: "RESERVED" } },
        select: { appliance: { select } },
      });
      rows = found.map((r) => ({ role: "PRIMARY" as const, appliance: r.appliance }));
    } else if (job.type === "REMOVAL") {
      const found = await prisma.applianceAssignment.findMany({
        where: { rentalLine: { agreementId: job.agreementId }, appliance: { status: "AWAITING_PICKUP" } },
        select: { appliance: { select } },
      });
      rows = found.map((r) => ({ role: "PRIMARY" as const, appliance: r.appliance }));
    }
  }
  const seen = new Set<string>();
  return rows
    .filter((r) => !seen.has(r.appliance.id) && seen.add(r.appliance.id))
    .sort((a, b) => (a.appliance.id < b.appliance.id ? -1 : 1))
    .map((r) => ({
      applianceId: r.appliance.id,
      label: `${r.appliance.applianceType.name} #${r.appliance.assetNumber}`,
      role: r.role,
      allowed: [...allowedResults(job.type, r.role)],
      defaultResult: positiveResultFor(job.type, r.role),
    }));
}

const MAX_HANDOFF_ATTEMPTS = 5;
const BLOCKED_HANDOFF_PREFIX = "BLOCKED:";
const UNKNOWN_HANDOFF_PREFIX = "UNKNOWN:";

type HandoffQueueRow = {
  id: string;
  kind: "START_RECURRING_BILLING" | "PUSH_CREDIT";
  subjectId: string;
  status: "PENDING" | "IN_FLIGHT" | "DONE" | "FAILED";
  attempts: number;
  claimedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
};

function deferredHandoffTime(row: Pick<HandoffQueueRow, "lastError" | "createdAt">): number {
  if (
    row.lastError?.startsWith(BLOCKED_HANDOFF_PREFIX) ||
    row.lastError?.startsWith(UNKNOWN_HANDOFF_PREFIX)
  ) {
    const parsed = Date.parse(row.lastError.slice(BLOCKED_HANDOFF_PREFIX.length, BLOCKED_HANDOFF_PREFIX.length + 24));
    if (Number.isFinite(parsed)) return parsed;
  }
  return row.createdAt.getTime();
}

/**
 * Runs durable post-commit provider work. A handoff has one exclusive lease at
 * a time; stale leases can be recovered, and a provider command must return an
 * explicit DONE outcome before the handoff is finalized.
 *
 * Normal retryable/recovery work always gets the first seats in a sweep. Work
 * blocked on a customer prerequisite or provider reconciliation only fills
 * spare capacity. Deferred BLOCKED and UNKNOWN families are merged by their
 * embedded retry timestamp so neither state prefix can starve the other.
 *
 * A recurring-billing RETRY that exhausted the normal attempt ceiling gets one
 * more low-priority finalization opportunity only after reconciliation has
 * linked a Stripe subscription to the agreement. The billing command then
 * follows its local-only recovery path and cannot issue another subscription
 * create, repairing the delivery-based billing anchor without provider hammering.
 */
async function runHandoffs(scope: { ids?: string[]; limit?: number }): Promise<{ done: number; failed: number }> {
  const staleBefore = new Date(Date.now() - PROVIDER_OPERATION_LEASE_MS);
  const limit = scope.limit ?? 50;
  const idScope = scope.ids ? { id: { in: scope.ids } } : {};

  const priorityRows: HandoffQueueRow[] = await prisma.jobBillingHandoff.findMany({
    where: {
      ...idScope,
      OR: [
        { status: "PENDING", attempts: { lt: MAX_HANDOFF_ATTEMPTS } },
        { status: "FAILED", attempts: { lt: MAX_HANDOFF_ATTEMPTS }, lastError: null },
        {
          status: "FAILED",
          attempts: { lt: MAX_HANDOFF_ATTEMPTS },
          lastError: { not: null },
          NOT: [
            { lastError: { startsWith: BLOCKED_HANDOFF_PREFIX } },
            { lastError: { startsWith: UNKNOWN_HANDOFF_PREFIX } },
          ],
        },
        // A stale lease is recovery work, not a fresh retry. It must remain
        // reclaimable even when the dead worker had already claimed attempt 5.
        { status: "IN_FLIGHT", claimedAt: { lte: staleBefore } },
      ],
    },
    select: {
      id: true,
      kind: true,
      subjectId: true,
      status: true,
      attempts: true,
      claimedAt: true,
      lastError: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
  });

  const remaining = Math.max(0, limit - priorityRows.length);
  let deferredRows: HandoffQueueRow[] = [];
  if (remaining > 0) {
    const deferredSelect = {
      id: true,
      kind: true,
      subjectId: true,
      status: true,
      attempts: true,
      claimedAt: true,
      lastError: true,
      createdAt: true,
    } as const;
    const [blockedRows, unknownRows, recoveredRetryRows] = await Promise.all([
      prisma.jobBillingHandoff.findMany({
        where: {
          ...idScope,
          status: "FAILED",
          lastError: { startsWith: BLOCKED_HANDOFF_PREFIX },
        },
        select: deferredSelect,
        orderBy: [{ lastError: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: remaining,
      }),
      prisma.jobBillingHandoff.findMany({
        where: {
          ...idScope,
          status: "FAILED",
          lastError: { startsWith: UNKNOWN_HANDOFF_PREFIX },
        },
        select: deferredSelect,
        orderBy: [{ lastError: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: remaining,
      }),
      scope.ids
        ? Promise.resolve([] as HandoffQueueRow[])
        : prisma.$queryRaw<HandoffQueueRow[]>`
            SELECT
              h."id",
              h."kind",
              h."subjectId",
              h."status",
              h."attempts",
              h."claimedAt",
              h."lastError",
              h."createdAt"
            FROM "JobBillingHandoff" h
            INNER JOIN "RentalAgreement" a ON a."id" = h."subjectId"
            WHERE h."status" = 'FAILED'
              AND h."kind" = 'START_RECURRING_BILLING'
              AND h."attempts" >= ${MAX_HANDOFF_ATTEMPTS}
              AND a."stripeSubscriptionId" IS NOT NULL
            ORDER BY h."createdAt" ASC, h."id" ASC
            LIMIT ${remaining}
          `,
    ]);

    const byId = new Map<string, HandoffQueueRow>();
    for (const row of [...blockedRows, ...unknownRows, ...recoveredRetryRows]) byId.set(row.id, row);
    deferredRows = [...byId.values()]
      .sort((a, b) => {
        const time = deferredHandoffTime(a) - deferredHandoffTime(b);
        if (time !== 0) return time;
        const created = a.createdAt.getTime() - b.createdAt.getTime();
        if (created !== 0) return created;
        return a.id.localeCompare(b.id);
      })
      .slice(0, remaining);
  }
  const rows = [...priorityRows, ...deferredRows];

  let done = 0;
  let failed = 0;
  for (const row of rows) {
    const claimedAt = new Date();
    const claim = await prisma.jobBillingHandoff.updateMany({
      where: {
        id: row.id,
        attempts: row.attempts,
        status: row.status,
        ...(row.status === "IN_FLIGHT" ? { claimedAt: { lte: staleBefore } } : {}),
        ...(row.status === "FAILED" ? { lastError: row.lastError } : {}),
      },
      data: {
        status: "IN_FLIGHT",
        claimedAt,
        attempts: { increment: 1 },
        doneAt: null,
        lastError: null,
      },
    });
    if (claim.count !== 1) continue;
    const expectedAttempts = row.attempts + 1;
    try {
      const work =
        row.kind === "START_RECURRING_BILLING"
          ? await startRecurringBillingForAgreement(row.subjectId)
          : await pushLateDeliveryCreditForHandoff(row.subjectId);
      if (work.state === "DONE") {
        const finalized = await prisma.jobBillingHandoff.updateMany({
          where: { id: row.id, status: "IN_FLIGHT", attempts: expectedAttempts },
          data: { status: "DONE", claimedAt: null, doneAt: new Date(), lastError: null },
        });
        if (finalized.count === 1) done += 1;
        continue;
      }

      const deferred = work.state === "BLOCKED" || work.state === "UNKNOWN";
      const detail = deferred
        ? `${work.state}:${new Date().toISOString()}: ${work.detail}`.slice(0, 500)
        : `${work.state}: ${work.detail}`.slice(0, 500);
      const released = await prisma.jobBillingHandoff.updateMany({
        where: { id: row.id, status: "IN_FLIGHT", attempts: expectedAttempts },
        data: {
          status: "FAILED",
          claimedAt: null,
          doneAt: null,
          lastError: detail,
          ...(deferred ? { attempts: { decrement: 1 } } : {}),
        },
      });
      if (released.count === 1) failed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
      const released = await prisma.jobBillingHandoff.updateMany({
        where: { id: row.id, status: "IN_FLIGHT", attempts: expectedAttempts },
        data: { status: "FAILED", claimedAt: null, doneAt: null, lastError: message },
      });
      if (released.count === 1) failed += 1;
      console.error(`Job billing handoff ${row.id} (${row.kind}) failed:`, error);
    }
  }
  return { done, failed };
}

/** Nightly sweep: finish handoffs that are still pending, failed, or abandoned in flight. */
export async function runPendingHandoffs(limit = 50): Promise<{ done: number; failed: number }> {
  return runHandoffs({ limit });
}
