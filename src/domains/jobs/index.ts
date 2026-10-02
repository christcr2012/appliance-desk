import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import type { JobStatus, JobType, Prisma } from "@prisma/client";
import { applianceStatusOnJobCompleted } from "@/domains/inventory/lifecycle";
import { startRecurringBillingForAgreement } from "@/domains/billing/checkout";
import { parseChecklist, type ChecklistItem } from "./checklist";
import { businessDayBounds } from "@/lib/business-date";
import { ASSUMED_JOB_DURATION_MINUTES } from "./dispatch";
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
};

export async function createJob(userId: string, input: NewJobInput) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);

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
        newValue: { type: input.type, customerId: input.customerId },
      },
    });

    return job;
  });
}

export async function updateJobStatus(
  userId: string,
  jobId: string,
  newStatus: JobStatus,
  completionNotes?: string | null,
) {
  const { updated, before } = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId);

    const before = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    const check = canTransitionJobStatus(before.status, newStatus);
    if (!check.ok) throw new Error(check.reason);

    const result = await tx.job.updateMany({
      where: { id: jobId, status: before.status },
      data: {
        status: newStatus,
        completedAt:
          newStatus === "COMPLETED" ? new Date() : before.completedAt,
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
        newValue: { status: newStatus },
      },
    });

    if (newStatus === "COMPLETED") {
      await applyJobCompletionToAppliances(tx, userId, before);
    }

    const updated = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    return { updated, before };
  });

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

async function applyJobCompletionToAppliances(
  tx: Prisma.TransactionClient,
  userId: string,
  job: { id: string; type: JobType; agreementId: string | null },
) {
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
  const padding = ASSUMED_JOB_DURATION_MINUTES * 60 * 1000;
  const [conflictCandidates, unscheduled] = await Promise.all([
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
  ]);

  const scheduled = conflictCandidates.filter(
    (job) =>
      job.scheduledAt &&
      job.scheduledAt >= rangeStart &&
      job.scheduledAt < rangeEnd,
  );
  return { scheduled, unscheduled, conflictCandidates };
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
      data: { checklist },
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
