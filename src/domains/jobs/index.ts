import { requireRole } from "@/lib/session";
import { assertValidRepairCostCents } from "./repair-costs";
import { prisma } from "@/lib/prisma";
import type { JobStatus, JobType, Prisma } from "@prisma/client";
import { parseChecklist, type ChecklistItem } from "./checklist";
import { businessDayBounds } from "@/lib/business-date";
import { MAX_JOB_DURATION_MINUTES } from "./dispatch";
import { releaseSwapReservationsInTx } from "./swaps";
import { lockMaintenanceRequestInTx, requestAfterVisitEndedInTx, requestAfterVisitStartedInTx } from "@/domains/maintenance/visit-sync";
import {
  checkConfirmedConflicts,
  lockUsersForScheduling,
  readDefaultJobMinutes,
  validateDurationMinutes,
} from "./scheduling";
import { assertActiveTeamActor, type TeamRole } from "@/lib/team-actor";
import { assertJobScopeInTx } from "./scope";

export { sendJobDayOfReminders } from "./day-of-reminders";
export {
  completeJob,
  runPendingHandoffs,
  getJobCompletionScope,
  JobCompletionConflictError,
  type CompleteJobInput,
  type CompleteJobResult,
} from "./completion";

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
      // Renewal start and field-job creation share this row lock. Whichever wins
      // is visible to the other before it decides whether old-agreement work is
      // still valid, so a job cannot slip in after the renewal conflict check.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "RentalAgreement" WHERE "id" = ${input.agreementId} FOR UPDATE
      `;
      if (locked.length !== 1) {
        throw new Error("Choose an agreement belonging to this customer and property.");
      }
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
      if (["DELIVERY", "INSTALLATION", "REMOVAL"].includes(input.type)) {
        const successors = await tx.rentalAgreement.findMany({
          where: {
            renewedFromAgreementId: input.agreementId,
            status: { in: ["ACTIVE", "ENDED", "CANCELLED"] },
          },
          select: { id: true, status: true },
        });
        const currentOrEndedSuccessor = successors.find((successor) => successor.status !== "CANCELLED");
        const cancelledSuccessorIds = successors
          .filter((successor) => successor.status === "CANCELLED")
          .map((successor) => successor.id);
        const startedCancelledSuccessor =
          cancelledSuccessorIds.length > 0
            ? await tx.auditLog.findFirst({
                where: {
                  action: "agreement.renewal_started",
                  entityType: "RentalAgreement",
                  entityId: { in: cancelledSuccessorIds },
                },
                select: { id: true },
              })
            : null;
        if (currentOrEndedSuccessor || startedCancelledSuccessor) {
          throw new Error(
            "This rental has already renewed. Schedule delivery, installation, or removal work on the current agreement instead.",
          );
        }
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

/**
 * Starts or cancels a job. Completing a job is a different command, `completeJob`, because every
 * appliance on the visit needs its own result.
 */
export async function updateJobStatus(
  userId: string,
  jobId: string,
  newStatus: JobStatus,
  completionNotes?: string | null,
) {
  if (newStatus === "COMPLETED") throw new Error("Use Complete job so each appliance gets a result.");

  return prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, userId);
    await assertJobScopeInTx(tx, { userId, role: actor.role as TeamRole }, { jobId, write: "STATUS" });

    const peeked = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    // Lock order: the maintenance request (if any) before the job.
    if (peeked.maintenanceRequestId) await lockMaintenanceRequestInTx(tx, peeked.maintenanceRequestId);
    const before = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    const check = canTransitionJobStatus(before.status, newStatus);
    if (!check.ok) throw new Error(check.reason);

    if (newStatus === "CANCELLED") {
      // A cancelled swap gives back the replacement it reserved.
      await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${jobId} FOR UPDATE`;
    }
    const result = await tx.job.updateMany({
      where: { id: jobId, status: before.status },
      data: {
        status: newStatus,
        version: { increment: 1 },
        completionNotes: completionNotes !== undefined ? completionNotes : before.completionNotes,
      },
    });
    if (result.count !== 1) {
      throw new Error("This job was just changed by someone else — refresh the page and try again.");
    }

    if (newStatus === "CANCELLED") await releaseSwapReservationsInTx(tx, userId, jobId, "Swap cancelled");
    if (before.maintenanceRequestId && before.type === "MAINTENANCE_VISIT") {
      if (newStatus === "IN_PROGRESS") await requestAfterVisitStartedInTx(tx, userId, before.maintenanceRequestId, jobId);
      if (newStatus === "CANCELLED") await requestAfterVisitEndedInTx(tx, userId, before.maintenanceRequestId, jobId, "CANCELLED");
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: "job.status",
        entityType: "Job",
        entityId: jobId,
        oldValue: { status: before.status },
        newValue: { status: newStatus },
      },
    });

    return tx.job.findUniqueOrThrow({ where: { id: jobId } });
  });
}

export async function addJobPhoto(
  userId: string,
  jobId: string,
  input: { url: string; altText?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, userId);
    await assertJobScopeInTx(tx, { userId, role: actor.role as TeamRole }, { jobId, write: "PHOTO" });

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
  assertValidRepairCostCents(costs.partsCostCents, "Parts cost");
  assertValidRepairCostCents(costs.laborCostCents, "Labor cost");
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    // When parts were itemized from the parts ledger, that list is the parts cost: a second hand-entered
    // number would be counted twice, so it is refused.
    if (costs.partsCostCents !== null) {
      const itemized = await tx.partStockMovement.count({ where: { jobId, kind: "USAGE" } });
      if (itemized > 0) {
        throw new Error("This job's parts were itemized from your parts list, so their cost comes from there. Clear the parts cost to save labor.");
      }
    }
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
    const actor = await assertActiveTeamActor(tx, userId);
    const scope = await assertJobScopeInTx(tx, { userId, role: actor.role as TeamRole }, { jobId, write: "CHECKLIST" });
    // A finished or cancelled job's checklist is part of its record and is never edited.
    if (scope.status === "COMPLETED" || scope.status === "CANCELLED") {
      throw new Error("A finished or cancelled job's checklist can't be changed.");
    }
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
