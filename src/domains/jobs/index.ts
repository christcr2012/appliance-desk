import { prisma } from "@/lib/prisma";
import type { JobStatus, JobType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Jobs — one scheduled visit (delivery, install, swap, removal, or a
// maintenance visit). See docs/BUSINESS-RULES.md: "Chris manually
// schedules the delivery/installation Job" once an agreement is signed.
// A job can exist without an agreement too (e.g. a one-off removal).
// ---------------------------------------------------------------------------

const ALLOWED_JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** Pure — see tests/jobs.test.ts. */
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

export async function getJobs(filter?: { status?: JobStatus }) {
  return prisma.job.findMany({
    where: filter?.status ? { status: filter.status } : undefined,
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      serviceAddress: true,
      appliances: { include: { appliance: { include: { applianceType: true } } } },
    },
    orderBy: [{ scheduledAt: "asc" }],
  });
}

export async function getJobById(id: string) {
  return prisma.job.findUnique({
    where: { id },
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      serviceAddress: true,
      agreement: true,
      maintenanceRequest: true,
      appliances: { include: { appliance: { include: { applianceType: true } } } },
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
  const job = await prisma.job.create({
    data: {
      type: input.type,
      scheduledAt: input.scheduledAt ?? null,
      customerId: input.customerId || null,
      serviceAddressId: input.serviceAddressId || null,
      agreementId: input.agreementId || null,
      maintenanceRequestId: input.maintenanceRequestId || null,
      notes: input.notes || null,
      appliances: input.applianceIds?.length
        ? { create: input.applianceIds.map((applianceId) => ({ applianceId })) }
        : undefined,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "job.create",
      entityType: "Job",
      entityId: job.id,
      newValue: { type: input.type, customerId: input.customerId },
    },
  });

  return job;
}

/** Changes a job's status, enforcing the allowed-transition rules
 * server-side (see canTransitionJobStatus). Marking a job COMPLETED
 * also stamps completedAt. */
export async function updateJobStatus(
  userId: string,
  jobId: string,
  newStatus: JobStatus,
  completionNotes?: string | null,
) {
  const before = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });

  const check = canTransitionJobStatus(before.status, newStatus);
  if (!check.ok) {
    throw new Error(check.reason);
  }

  const updated = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: newStatus,
      completedAt: newStatus === "COMPLETED" ? new Date() : before.completedAt,
      completionNotes:
        completionNotes !== undefined ? completionNotes : before.completionNotes,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "job.status",
      entityType: "Job",
      entityId: jobId,
      oldValue: { status: before.status },
      newValue: { status: newStatus },
    },
  });

  return updated;
}

/** Adds a condition photo to a job — pasted URL for now (same pattern as
 * ApplianceType.photoUrl in /desk/settings), since there's no file
 * upload/blob storage decision made yet — see docs/ROADMAP.md. */
export async function addJobPhoto(
  userId: string,
  jobId: string,
  input: { url: string; altText?: string | null },
) {
  const photo = await prisma.photo.create({
    data: { jobId, url: input.url, altText: input.altText || null },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "job.photo.add",
      entityType: "Job",
      entityId: jobId,
    },
  });

  return photo;
}

/**
 * Records what a repair job actually cost — parts and labor, entered by
 * Chris (usually right when he marks a MAINTENANCE_VISIT job COMPLETED,
 * but editable any time). This is the raw data appliance profitability/
 * ROI (src/domains/inventory/analytics.ts) rolls up per appliance; a job
 * with nothing entered simply contributes $0, never a guessed number.
 * Deliberately not restricted to MAINTENANCE_VISIT jobs at the database
 * level — the desk UI only shows the fields for that type, but nothing
 * here assumes it, in case Chris ever wants to log an incidental cost on
 * another job type.
 */
export async function setJobRepairCosts(
  userId: string,
  jobId: string,
  costs: { partsCostCents: number | null; laborCostCents: number | null },
) {
  const updated = await prisma.job.update({
    where: { id: jobId },
    data: {
      partsCostCents: costs.partsCostCents,
      laborCostCents: costs.laborCostCents,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "job.repairCosts",
      entityType: "Job",
      entityId: jobId,
      newValue: costs,
    },
  });

  return updated;
}
