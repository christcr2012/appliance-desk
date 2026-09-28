import { prisma } from "@/lib/prisma";
import type { JobStatus, JobType } from "@prisma/client";
import { applianceStatusOnJobCompleted } from "@/domains/inventory/lifecycle";
import { startRecurringBillingForAgreement } from "@/domains/billing/checkout";

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
 * also stamps completedAt.
 *
 * Guards against a conflicting simultaneous edit (real gap fixed
 * 2026-09-27, found by a code review — see docs/DECISIONS.md): this used
 * to read the job's current status, decide the transition was allowed,
 * then write unconditionally — if two requests for the same job
 * overlapped (two tabs, a double-click, a retried request), the second
 * write would silently win over the first with no warning, and the audit
 * log would show a transition that doesn't actually reflect what
 * happened. The actual update is now conditional on the status still
 * being what was just read (same atomic-check pattern already used for
 * appliance reservations in src/domains/agreements/index.ts) — if
 * something else changed the job in between, this throws a clear error
 * instead of clobbering it. */
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

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.job.updateMany({
      where: { id: jobId, status: before.status },
      data: {
        status: newStatus,
        completedAt: newStatus === "COMPLETED" ? new Date() : before.completedAt,
        completionNotes:
          completionNotes !== undefined ? completionNotes : before.completionNotes,
      },
    });

    if (result.count === 0) {
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

    return tx.job.findUniqueOrThrow({ where: { id: jobId } });
  });

  // Billing starts at delivery (2026-09-28, Chris's explicit decision —
  // see docs/BUSINESS-RULES.md's Billing rules), so completing a
  // delivery/installation job for an agreement is what actually starts
  // its real Stripe Subscription. Deliberately OUTSIDE the transaction
  // above (a Stripe network call has no business holding a database
  // transaction open) and never allowed to fail the job completion
  // itself — the machine really was delivered regardless of whether
  // Stripe cooperates; a real problem starting billing is recorded on
  // the agreement (billingBlockedReason) rather than thrown here, same
  // principle as the "signed but Checkout Session failed" handling in
  // src/app/sign/[id]/actions.ts.
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

type JobTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Rental lifecycle (2026-09-28, docs/BUSINESS-RULES.md): completing a job
 * moves its appliances along automatically, inside the same transaction
 * as the job's own status change —
 *   - delivery / installation: RESERVED → RENTED (this, not signing, is
 *     when a machine is actually out with a customer)
 *   - removal (pickup): AWAITING_PICKUP (or RENTED) → AWAITING_INSPECTION
 * Maintenance visits and swaps are left to Chris (the job page suggests
 * a next status for those). Which appliances: the ones listed on the job;
 * if none were listed but the job belongs to an agreement, that
 * agreement's own appliances — so forgetting to tick the boxes when
 * scheduling a delivery doesn't silently skip the whole lifecycle. Each
 * change is conditional on the status just read (same race-safe pattern
 * as everywhere else) and audit-logged.
 */
async function applyJobCompletionToAppliances(
  tx: JobTx,
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
        where: { unassignedAt: null, rentalLine: { agreementId: job.agreementId } },
        select: { applianceId: true },
      });
      applianceIds = assignments.map((a) => a.applianceId);
    } else if (job.type === "REMOVAL") {
      const assignments = await tx.applianceAssignment.findMany({
        where: {
          rentalLine: { agreementId: job.agreementId },
          appliance: { status: "AWAITING_PICKUP" },
        },
        select: { applianceId: true },
      });
      applianceIds = [...new Set(assignments.map((a) => a.applianceId))];
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
    if (moved.count !== 1) continue; // changed by something else meanwhile — leave it

    await tx.auditLog.create({
      data: {
        userId,
        action: "appliance.unit.status",
        entityType: "Appliance",
        entityId: applianceId,
        oldValue: { status: appliance.status },
        newValue: { status: next, reason: `Job ${job.type.toLowerCase()} completed`, jobId: job.id },
      },
    });
  }
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
