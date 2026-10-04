import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import type { JobStatus, JobType, Prisma } from "@prisma/client";
import { applianceStatusOnJobCompleted } from "@/domains/inventory/lifecycle";
import { startRecurringBillingForAgreement } from "@/domains/billing/checkout";
import {
  jobServiceDate,
  parsePerformedOn,
  pushLateDeliveryCreditToStripe,
  recordItemsNotDelivered,
  recordLateDeliveries,
  recordLateReturnOnRemoval,
  type PickupBillingOutcome,
} from "@/domains/billing/pickup-billing-events";
import { parseChecklist, type ChecklistItem } from "./checklist";
import { businessDayBounds } from "@/lib/business-date";
import { MAX_JOB_DURATION_MINUTES } from "./dispatch";
import {
  checkConfirmedConflicts,
  lockUsersForScheduling,
  readDefaultJobMinutes,
  validateDurationMinutes,
} from "./scheduling";
import { assertActiveTeamActor } from "@/lib/team-actor";

export { sendJobDayOfReminders } from "./day-of-reminders";

const ALLOWED_JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionJobStatus(
  from: JobStatus,
  to: JobStatus,
): { ok: true } | { ok: false; reason: string } {
  if (from === to) {
    return { ok: false, reason: "That's already its current status." };
  }
  if (ALLOWED_JOB_TRANSITIONS[from].includes(to)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `Can't move a job directly from ${from} to ${to}.`,
  };
}

const JOB_OPERATIONAL_SELECT = {
  id: true,
  type: true,
  status: true,
  scheduledAt: true,
  assignedToUserId: true,
  durationMinutes: true,
  version: true,
  noShowAt: true,
  assignedTo: { select: { id: true, name: true, email: true } },
  completedAt: true,
  createdAt: true,
  notes: true,
  completionNotes: true,
  checklist: true,
  customerId: true,
  serviceAddressId: true,
  agreementId: true,
  customer: {
    select: {
      phone: true,
      user: { select: { name: true, email: true } },
    },
  },
  serviceAddress: {
    select: {
      id: true,
      line1: true,
      line2: true,
      city: true,
      state: true,
      zip: true,
    },
  },
  appliances: {
    select: {
      appliance: {
        select: {
          id: true,
          assetNumber: true,
          status: true,
          applianceType: { select: { name: true } },
        },
      },
    },
  },
} as const;

export async function getJobsCount(filter?: { status?: JobStatus }): Promise<number> {
  await requireRole("OWNER", "ADMIN", "STAFF");
  return prisma.job.count({
    where: filter?.status ? { status: filter.status } : undefined,
  });
}

export async function getJobsPage(
  filter: { status?: JobStatus } | undefined,
  skip: number,
  pageSize: number,
) {
  await requireRole("OWNER", "ADMIN", "STAFF");
  return prisma.job.findMany({
    where: filter?.status ? { status: filter.status } : undefined,
    select: JOB_OPERATIONAL_SELECT,
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    skip,
    take: pageSize,
  });
}

export async function getDriverJobsForToday() {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const { start: startOfDay, end: startOfTomorrow } = businessDayBounds();

  return prisma.job.findMany({
    where: {
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      scheduledAt: { gte: startOfDay, lt: startOfTomorrow },
    },
    select: JOB_OPERATIONAL_SELECT,
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
  });
}

export async function getJobById(id: string) {
  await requireRole("OWNER", "ADMIN");
  return prisma.job.findUnique({
    where: { id },
    include: {
      customer: {
        include: { user: { select: { name: true, email: true } } },
      },
      serviceAddress: true,
      agreement: true,
      maintenanceRequest: true,
      appliances: {
        include: { appliance: { include: { applianceType: true } } },
      },
      photos: { orderBy: [{ createdAt: "desc" }] },
    },
  });
}

/**
 * The appliances a DELIVERY/INSTALLATION job will mark as delivered when it is
 * completed: the ones listed on the job, or (when none are listed) every
 * appliance still assigned to its agreement. Staff pick from this list which
 * ones were NOT on the truck.
 */
export async function deliveryCandidatesForJob(job: {
  id: string;
  type: JobType;
  status: JobStatus;
  agreementId: string | null;
}): Promise<Array<{ id: string; label: string }>> {
  if ((job.type !== "DELIVERY" && job.type !== "INSTALLATION") || !job.agreementId || job.status === "COMPLETED" || job.status === "CANCELLED") {
    return [];
  }
  const listed = await prisma.jobAppliance.findMany({
    where: { jobId: job.id },
    select: { appliance: { select: { id: true, assetNumber: true, status: true, applianceType: { select: { name: true } } } } },
  });
  let rows = listed.map((r) => r.appliance);
  if (rows.length === 0) {
    const assignments = await prisma.applianceAssignment.findMany({
      where: { unassignedAt: null, rentalLine: { agreementId: job.agreementId } },
      select: { appliance: { select: { id: true, assetNumber: true, status: true, applianceType: { select: { name: true } } } } },
    });
    rows = assignments.map((r) => r.appliance);
  }
  const seen = new Set<string>();
  return rows
    .filter((a) => a.status === "RESERVED" && !seen.has(a.id) && seen.add(a.id))
    .map((a) => ({ id: a.id, label: `${a.applianceType.name} #${a.assetNumber}` }));
}

export type NewJobInput = {
  type: JobType;
  scheduledAt?: Date | null;
  customerId?: string | null;
  serviceAddressId?: string | null;
  agreementId?: string | null;
  maintenanceRequestId?: string | null;
  applianceIds?: string[];
  notes?: string | null;
  assignedToUserId?: string | null;
  durationMinutes?: number | null;
  /** Visits the person has already agreed to overlap; anything else that conflicts is refused. */
  confirmedConflictJobIds?: readonly string[];
};

export async function createJob(userId: string, input: NewJobInput) {
  return prisma.$transaction(async (tx) => {
    // Lock order (spec section 0): the people involved first, then everything else.
    await lockUsersForScheduling(tx, [userId, input.assignedToUserId]);
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    return createJobInTx(tx, userId, input);
  });
}

/** Everything after the actor check, for callers that already hold the user locks in a transaction. */
export async function createJobInTx(tx: Prisma.TransactionClient, userId: string, input: NewJobInput) {
    const durationMinutes = validateDurationMinutes(input.durationMinutes);
    if (input.assignedToUserId) {
      const assignee = await tx.user.findUnique({
        where: { id: input.assignedToUserId },
        select: { role: true, archivedAt: true },
      });
      if (!assignee || assignee.archivedAt || !["OWNER", "ADMIN", "STAFF"].includes(assignee.role)) {
        throw new Error("Choose an active team member to do this visit.");
      }
    }
    const overriddenConflictJobIds = await checkConfirmedConflicts(tx, {
      assigneeUserId: input.assignedToUserId ?? null,
      scheduledAt: input.scheduledAt ?? null,
      durationMinutes,
      excludeJobId: null,
      confirmedConflictJobIds: input.confirmedConflictJobIds ?? [],
    });

    if (input.serviceAddressId) {
      const address = await tx.serviceAddress.findUnique({
        where: { id: input.serviceAddressId },
        select: { customerId: true },
      });
      if (!address || !input.customerId || address.customerId !== input.customerId) {
        throw new Error("Choose a service address belonging to this customer.");
      }
    }

    if (input.agreementId) {
      const agreement = await tx.rentalAgreement.findUnique({
        where: { id: input.agreementId },
        select: { customerId: true, serviceAddressId: true },
      });
      if (
        !agreement ||
        !input.customerId ||
        agreement.customerId !== input.customerId ||
        (input.serviceAddressId && agreement.serviceAddressId !== input.serviceAddressId)
      ) {
        throw new Error("Choose an agreement belonging to this customer and property.");
      }
    }

    if (input.maintenanceRequestId) {
      const request = await tx.maintenanceRequest.findUnique({
        where: { id: input.maintenanceRequestId },
        select: { customerId: true },
      });
      if (!request || !input.customerId || request.customerId !== input.customerId) {
        throw new Error("Choose a service request belonging to this customer.");
      }
    }

    const job = await tx.job.create({
      data: {
        type: input.type,
        scheduledAt: input.scheduledAt ?? null,
        assignedToUserId: input.assignedToUserId || null,
        durationMinutes,
        customerId: input.customerId || null,
        serviceAddressId: input.serviceAddressId || null,
        agreementId: input.agreementId || null,
        maintenanceRequestId: input.maintenanceRequestId || null,
        notes: input.notes || null,
        appliances: input.applianceIds?.length
          ? {
              create: input.applianceIds.map((applianceId) => ({ applianceId })),
            }
          : undefined,
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "job.create",
        entityType: "Job",
        entityId: job.id,
        newValue: {
          type: input.type,
          customerId: input.customerId,
          ...(input.assignedToUserId ? { assignedToUserId: input.assignedToUserId } : {}),
          ...(overriddenConflictJobIds.length > 0 ? { overriddenConflictJobIds } : {}),
        },
      },
    });

    return job;
}

export type CompleteJobOptions = {
  /** The Colorado date the work was done (YYYY-MM-DD). Blank = today. Only used when completing. */
  performedOn?: string | null;
  /** DELIVERY/INSTALLATION only: agreement items that were NOT delivered on this visit. */
  notDeliveredApplianceIds?: string[];
};

export async function updateJobStatus(
  userId: string,
  jobId: string,
  newStatus: JobStatus,
  completionNotes?: string | null,
  options: CompleteJobOptions = {},
) {
  const performed = parsePerformedOn(options.performedOn);
  if (!performed.ok) throw new Error(performed.message);
  const notDelivered = [...new Set(options.notDeliveredApplianceIds ?? [])];

  const { updated, before, billing } = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId);

    const before = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    const check = canTransitionJobStatus(before.status, newStatus);
    if (!check.ok) throw new Error(check.reason);

    const completedAt = newStatus === "COMPLETED" ? new Date() : before.completedAt;
    const performedOn =
      newStatus === "COMPLETED" ? (performed.value ?? before.performedOn ?? businessDayBounds(completedAt ?? new Date()).start) : before.performedOn;
    const result = await tx.job.updateMany({
      where: { id: jobId, status: before.status },
      data: {
        status: newStatus,
        version: { increment: 1 },
        completedAt,
        performedOn,
        completionNotes:
          completionNotes !== undefined
            ? completionNotes
            : before.completionNotes,
      },
    });
    if (result.count !== 1) {
      throw new Error(
        "This job was just changed by someone else — refresh the page and try again.",
      );
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: "job.status",
        entityType: "Job",
        entityId: jobId,
        oldValue: { status: before.status },
        newValue: { status: newStatus, ...(newStatus === "COMPLETED" && performedOn ? { performedOn: performedOn.toISOString() } : {}) },
      },
    });

    const billing: PickupBillingOutcome[] = [];
    if (newStatus === "COMPLETED") {
      const isDelivery = before.type === "DELIVERY" || before.type === "INSTALLATION";
      if (notDelivered.length > 0 && !(isDelivery && before.agreementId)) {
        throw new Error("Only a delivery or installation job for a rental agreement can have items marked not delivered.");
      }
      const moved = await applyJobCompletionToAppliances(tx, userId, before, isDelivery ? notDelivered : []);
      const serviceDate = jobServiceDate({ performedOn, scheduledAt: before.scheduledAt, completedAt });

      // A completed job settles billing for the appliances it moved, in this
      // same transaction: late-return charges for a pickup, late-delivery
      // credits (and "not delivered" records) for a delivery.
      if (before.agreementId && before.type === "REMOVAL") {
        billing.push(
          await recordLateReturnOnRemoval(tx, { userId, jobId, agreementId: before.agreementId, applianceIds: moved, pickupDate: serviceDate }),
        );
      }
      if (before.agreementId && isDelivery) {
        billing.push(
          await recordLateDeliveries(tx, { userId, jobId, agreementId: before.agreementId, applianceIds: moved, deliveryDate: serviceDate }),
        );
        billing.push(
          await recordItemsNotDelivered(tx, { userId, jobId, agreementId: before.agreementId, applianceIds: notDelivered, deliveryDate: serviceDate }),
        );
      }
      const notes = billing.flatMap((b) => b.notes);
      if (notes.length > 0) {
        await tx.auditLog.create({
          data: {
            userId,
            action: "job.pickup_billing",
            entityType: "Job",
            entityId: jobId,
            newValue: {
              agreementId: before.agreementId,
              serviceDate: serviceDate.toISOString(),
              lateReturnInvoiceId: billing.map((b) => b.lateReturnInvoiceId).find(Boolean) ?? null,
              creditIds: billing.flatMap((b) => b.creditIds),
              pendingDeliveryIds: billing.flatMap((b) => b.pendingDeliveryIds),
              notes,
            },
          },
        });
      }
    }

    const updated = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    return { updated, before, billing };
  });

  // Credits are sent to Stripe only once the local record is committed; a
  // failure here is retried by the billing reconciliation pass.
  for (const creditId of billing.flatMap((b) => b.creditIds)) {
    try {
      await pushLateDeliveryCreditToStripe(creditId);
    } catch (error) {
      console.error(`Job ${jobId} completed but couldn't send late-delivery credit ${creditId} to Stripe yet:`, error);
    }
  }

  if (
    newStatus === "COMPLETED" &&
    (before.type === "DELIVERY" || before.type === "INSTALLATION") &&
    before.agreementId
  ) {
    try {
      await startRecurringBillingForAgreement(before.agreementId);
    } catch (error) {
      console.error(
        `Job ${jobId} completed but couldn't start billing for agreement ${before.agreementId}:`,
        error,
      );
    }
  }

  return updated;
}

/**
 * Moves each of the job's appliances to its next status, skipping any the
 * staff marked as not delivered (those stay reserved for this customer).
 * Returns the ids that actually moved.
 */
async function applyJobCompletionToAppliances(
  tx: Prisma.TransactionClient,
  userId: string,
  job: { id: string; type: JobType; agreementId: string | null },
  skipApplianceIds: string[] = [],
): Promise<string[]> {
  const listed = await tx.jobAppliance.findMany({
    where: { jobId: job.id },
    select: { applianceId: true },
  });
  let applianceIds = listed.map((row) => row.applianceId);

  if (applianceIds.length === 0 && job.agreementId) {
    if (job.type === "DELIVERY" || job.type === "INSTALLATION") {
      const assignments = await tx.applianceAssignment.findMany({
        where: {
          unassignedAt: null,
          rentalLine: { agreementId: job.agreementId },
        },
        select: { applianceId: true },
      });
      applianceIds = assignments.map((assignment) => assignment.applianceId);
    } else if (job.type === "REMOVAL") {
      const assignments = await tx.applianceAssignment.findMany({
        where: {
          rentalLine: { agreementId: job.agreementId },
          appliance: { status: "AWAITING_PICKUP" },
        },
        select: { applianceId: true },
      });
      applianceIds = [
        ...new Set(assignments.map((assignment) => assignment.applianceId)),
      ];
    }
  }

  // Lock every unit this job may move, sorted by id (spec lock order), and keep the locks to the end of the
  // transaction. A second job moving the same unit at this moment then either finishes first (and the
  // "still waiting" check below refuses) or waits until this job's "not delivered" record is committed.
  if (applianceIds.length > 0) {
    await tx.$queryRaw`
      SELECT "id" FROM "Appliance" WHERE "id" = ANY(${[...applianceIds].sort()}) ORDER BY "id" FOR UPDATE
    `;
  }

  if (skipApplianceIds.length > 0) {
    const unknown = skipApplianceIds.filter((id) => !applianceIds.includes(id));
    if (unknown.length > 0) {
      throw new Error("An item marked not delivered is not one of this job's appliances.");
    }
    // Only a unit still waiting for delivery can be "not delivered"; one already out with the customer cannot.
    const notWaiting = await tx.appliance.count({ where: { id: { in: skipApplianceIds }, status: { not: "RESERVED" } } });
    if (notWaiting > 0) {
      throw new Error("An item marked not delivered is not waiting for delivery (it was already delivered or released).");
    }
    applianceIds = applianceIds.filter((id) => !skipApplianceIds.includes(id));
  }

  const movedIds: string[] = [];
  for (const applianceId of applianceIds) {
    const appliance = await tx.appliance.findUniqueOrThrow({
      where: { id: applianceId },
      select: { status: true },
    });
    const next = applianceStatusOnJobCompleted(job.type, appliance.status);
    if (!next) continue;

    const moved = await tx.appliance.updateMany({
      where: { id: applianceId, status: appliance.status },
      data: { status: next },
    });
    if (moved.count !== 1) continue;
    movedIds.push(applianceId);

    await tx.auditLog.create({
      data: {
        userId,
        action: "appliance.unit.status",
        entityType: "Appliance",
        entityId: applianceId,
        oldValue: { status: appliance.status },
        newValue: {
          status: next,
          reason: `Job ${job.type.toLowerCase()} completed`,
          jobId: job.id,
        },
      },
    });
  }
  return movedIds;
}

export async function addJobPhoto(
  userId: string,
  jobId: string,
  input: { url: string; altText?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId);
    await tx.job.findUniqueOrThrow({ where: { id: jobId }, select: { id: true } });

    const photo = await tx.photo.create({
      data: { jobId, url: input.url, altText: input.altText || null },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "job.photo.add",
        entityType: "Job",
        entityId: jobId,
      },
    });
    return photo;
  });
}

export async function setJobRepairCosts(
  userId: string,
  jobId: string,
  costs: { partsCostCents: number | null; laborCostCents: number | null },
) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const updated = await tx.job.update({
      where: { id: jobId },
      data: {
        partsCostCents: costs.partsCostCents,
        laborCostCents: costs.laborCostCents,
        version: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "job.repairCosts",
        entityType: "Job",
        entityId: jobId,
        newValue: costs,
      },
    });
    return updated;
  });
}

export async function getDispatchBoardJobs(rangeStart: Date, rangeEnd: Date) {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const padding = MAX_JOB_DURATION_MINUTES * 60 * 1000;
  const [conflictCandidates, unscheduled, defaultJobMinutes] = await Promise.all([
    prisma.job.findMany({
      where: {
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        scheduledAt: {
          gte: new Date(rangeStart.getTime() - padding),
          lt: new Date(rangeEnd.getTime() + padding),
        },
      },
      select: JOB_OPERATIONAL_SELECT,
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    }),
    prisma.job.findMany({
      where: {
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        scheduledAt: null,
      },
      select: JOB_OPERATIONAL_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    readDefaultJobMinutes(prisma),
  ]);

  const scheduled = conflictCandidates.filter(
    (job) =>
      job.scheduledAt &&
      job.scheduledAt >= rangeStart &&
      job.scheduledAt < rangeEnd,
  );
  return { scheduled, unscheduled, conflictCandidates, defaultJobMinutes };
}

export async function getJobChecklist(jobId: string): Promise<ChecklistItem[]> {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { type: true, checklist: true },
  });
  return parseChecklist(job.checklist, job.type);
}

export async function updateJobChecklist(
  userId: string,
  jobId: string,
  checklist: ChecklistItem[],
) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId);
    const before = await tx.job.findUniqueOrThrow({
      where: { id: jobId },
      select: { checklist: true },
    });
    const updated = await tx.job.update({
      where: { id: jobId },
      data: { checklist, version: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "job.checklist.update",
        entityType: "Job",
        entityId: jobId,
        oldValue: { checklist: before.checklist },
        newValue: { checklist },
      },
    });
    return updated;
  });
}
