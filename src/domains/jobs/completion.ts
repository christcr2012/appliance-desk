import type { JobApplianceResult, JobApplianceRole, JobOutcome, JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor, type TeamRole } from "@/lib/team-actor";
import { assertJobScopeInTx } from "./scope";
import { businessDateKey, businessDayBounds } from "@/lib/business-date";
import { lockCustomerLedger } from "@/domains/billing/ledger";
import { lockRentalAgreementInTx } from "@/domains/agreements";
import { startRecurringBillingForAgreement } from "@/domains/billing/checkout";
import {
  jobServiceDate,
  pushLateDeliveryCreditToStripe,
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
// Lock order (spec section 0): actor, customer (when the job has an agreement), agreement,
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
    if (scopeIds.length > 0) {
      await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ANY(${scopeIds}) ORDER BY "id" FOR UPDATE`;
    }

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
        // Only a unit still waiting for delivery can be "not delivered".
        if (appliance.status !== "RESERVED") {
          throw new JobCompletionConflictError("An item marked not delivered is not waiting for delivery (it was already delivered or released).");
        }
      }

      if (result.result === "DELIVERED") {
        // Custody must be recordable before anything moves: a rented unit with no known holder is the one state we never create.
        if (!customerId) {
          throw new JobCompletionConflictError(`${appliance.assetNumber} can't be marked delivered on a visit with no customer. Open the job, choose the customer, then complete it.`);
        }
        if (isDelivery) {
          if (before.agreementId) {
            const assigned = await tx.applianceAssignment.findFirst({ where: { applianceId, unassignedAt: null, rentalLine: { agreementId: before.agreementId } }, select: { id: true } });
            if (!assigned) throw new JobCompletionConflictError(`${appliance.assetNumber} is not set aside for this customer's agreement, so it can't be marked delivered on this visit.`);
          }
          const moved = await tx.appliance.updateMany({ where: { id: applianceId, status: "RESERVED" }, data: { status: "RENTED" } });
          if (moved.count !== 1) throw new JobCompletionConflictError(`${appliance.assetNumber} is no longer waiting for delivery, so it can't be marked delivered.`);
          await tx.auditLog.create({
            data: { userId, action: "appliance.unit.status", entityType: "Appliance", entityId: applianceId, oldValue: { status: "RESERVED" }, newValue: { status: "RENTED", reason: `Job ${before.type.toLowerCase()} completed`, jobId: before.id } },
          });
        }
        // A swap's custody, status and assignment moves are done together after this loop.
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
        // The original's current assignment, whichever agreement it now belongs to (a renewal may have moved it).
        const originalAssignment = originalId
          ? await tx.applianceAssignment.findFirst({ where: { applianceId: originalId, unassignedAt: null }, select: { id: true, rentalLineId: true, rentalLine: { select: { agreementId: true } } } })
          : null;
        if (originalAssignment && originalAssignment.rentalLine.agreementId !== before.agreementId) {
          await lockRentalAgreementInTx(tx, originalAssignment.rentalLine.agreementId);
        }
        const replacementAssignment = await tx.applianceAssignment.findFirst({ where: { applianceId: replacementId, unassignedAt: null }, select: { id: true } });
        const moved = await tx.appliance.updateMany({ where: { id: replacementId, status: "RESERVED" }, data: { status: "RENTED" } });
        if (moved.count !== 1) throw new JobCompletionConflictError(`${replacement.assetNumber} is no longer waiting for delivery, so the swap can't be completed.`);
        await tx.auditLog.create({
          data: { userId, action: "appliance.unit.status", entityType: "Appliance", entityId: replacementId, oldValue: { status: "RESERVED" }, newValue: { status: "RENTED", reason: "Swap completed", jobId: before.id } },
        });
        await openCustodyEpisodeInTx(tx, { applianceId: replacementId, customerId: customerId!, serviceAddressId: before.serviceAddressId, agreementId: before.agreementId, startedOn: serviceDate, startJobId: before.id });
        if (originalAssignment) {
          await tx.applianceAssignment.update({
            where: { id: originalAssignment.id },
            data: { unassignedAt: completedAt, unassignReason: `Swapped for ${replacement.assetNumber}` },
          });
          if (!replacementAssignment) {
            await tx.applianceAssignment.create({ data: { rentalLineId: originalAssignment.rentalLineId, applianceId: replacementId } });
          }
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
        // An old swap job with no recorded replacement: only the returned unit's custody can be closed.
        await closeCustodyEpisodeInTx(tx, { applianceId: originalId, endedOn: serviceDate, endJobId: before.id, endReason: "Swapped out" });
      } else if (replacementId && swapBothNegative && reservationOwned) {
        // Nothing moved: the reservation goes back on the shelf.
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
    const deliveredIds = scopeIds.filter((id) => resultOf.get(id)!.result === "DELIVERED");
    if (before.agreementId && before.type === "REMOVAL") {
      billing.push(await recordLateReturnOnRemoval(tx, { userId, jobId: before.id, agreementId: before.agreementId, applianceIds: returnedIds, pickupDate: serviceDate }));
    }
    if (before.agreementId && isDelivery) {
      billing.push(await recordLateDeliveries(tx, { userId, jobId: before.id, agreementId: before.agreementId, applianceIds: deliveredIds, deliveryDate: serviceDate }));
      billing.push(await recordItemsNotDelivered(tx, { userId, jobId: before.id, agreementId: before.agreementId, applianceIds: notDeliveredIds, deliveryDate: serviceDate }));
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
    if (isDelivery && before.agreementId) handoffRows.push({ jobId: before.id, kind: "START_RECURRING_BILLING", subjectId: before.agreementId });
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

    return { jobId: before.id, outcome: jobOutcome, replayed: false, followUpTaskIds, handoffIds: handoffs.map((h) => h.id) };
  });

  if (!outcome.replayed && outcome.handoffIds.length > 0) await runHandoffs({ ids: outcome.handoffIds });
  return outcome;
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

/** Runs the post-commit provider work for handoff rows. Each existing function is already an idempotent durable operation. */
async function runHandoffs(scope: { ids?: string[]; limit?: number }): Promise<{ done: number; failed: number }> {
  const rows = await prisma.jobBillingHandoff.findMany({
    where: { ...(scope.ids ? { id: { in: scope.ids } } : {}), status: { in: ["PENDING", "FAILED"] }, attempts: { lt: MAX_HANDOFF_ATTEMPTS } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: scope.limit ?? 50,
  });
  let done = 0;
  let failed = 0;
  for (const row of rows) {
    // Claim by attempt count so two sweeps do not run the same row twice at once.
    const claim = await prisma.jobBillingHandoff.updateMany({
      where: { id: row.id, status: { in: ["PENDING", "FAILED"] }, attempts: row.attempts },
      data: { attempts: { increment: 1 } },
    });
    if (claim.count !== 1) continue;
    try {
      if (row.kind === "START_RECURRING_BILLING") await startRecurringBillingForAgreement(row.subjectId);
      else await pushLateDeliveryCreditToStripe(row.subjectId);
      // Never let a slower worker undo a finished one: the provider operations are idempotent, so a rare double run is harmless, but the record must stay DONE.
      await prisma.jobBillingHandoff.updateMany({ where: { id: row.id, status: { not: "DONE" } }, data: { status: "DONE", doneAt: new Date(), lastError: null } });
      done += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
      await prisma.jobBillingHandoff.updateMany({ where: { id: row.id, status: { not: "DONE" } }, data: { status: "FAILED", lastError: message } });
      console.error(`Job billing handoff ${row.id} (${row.kind}) failed:`, error);
    }
  }
  return { done, failed };
}

/** Nightly sweep: finish handoffs that are still pending or failed (fewer than 5 attempts). */
export async function runPendingHandoffs(limit = 50): Promise<{ done: number; failed: number }> {
  return runHandoffs({ limit });
}
