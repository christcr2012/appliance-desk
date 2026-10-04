import type { JobType, Prisma } from "@prisma/client";
import { releaseSwapReservationsInTx } from "./swaps";
import { lockMaintenanceRequestInTx, requestAfterVisitEndedInTx } from "@/domains/maintenance/visit-sync";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor, type TeamRole } from "@/lib/team-actor";
import { assertJobScopeInTx } from "./scope";
import { businessDateKey } from "@/lib/business-date";

// ---------------------------------------------------------------------------
// Scheduling (Batch C, slice P1-A). Who does a visit, how long it takes, and
// whether the same person is double-booked. Pure interval helpers first, then
// the database commands. Lock order (spec section 0): User rows (sorted by id)
// first, then the Job row. Conflicts are between jobs with the same assignee;
// the assignee's User row is the thing that is locked, because a conflict check
// against several other jobs cannot be protected by locking any one of them.
// ---------------------------------------------------------------------------

export const MIN_JOB_DURATION_MINUTES = 15;
export const MAX_JOB_DURATION_MINUTES = 720;
/** Used only when BusinessSettings cannot be read. The owner's real value lives in settings. */
export const FALLBACK_JOB_DURATION_MINUTES = 120;

export type JobInterval = { start: Date; end: Date };

export function jobInterval(
  job: { scheduledAt: Date; durationMinutes: number | null },
  defaultMinutes: number,
): JobInterval {
  const minutes = job.durationMinutes ?? defaultMinutes;
  return { start: job.scheduledAt, end: new Date(job.scheduledAt.getTime() + minutes * 60_000) };
}

/** Half-open intervals: a visit that ends exactly when the next starts does not conflict. */
export function intervalsOverlap(a: JobInterval, b: JobInterval): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

export type JobConflict = {
  jobId: string;
  type: JobType;
  scheduledAt: Date;
  durationMinutes: number | null;
  customerName: string | null;
};

export class JobScheduleConflictError extends Error {
  constructor(readonly conflicts: JobConflict[]) {
    super(
      conflicts.length === 1
        ? "This person already has another visit at that time."
        : `This person already has ${conflicts.length} other visits at that time.`,
    );
    this.name = "JobScheduleConflictError";
  }
}

export class JobVersionError extends Error {
  constructor() {
    super("Someone else changed this job just now — reload the page to see their update before saving yours.");
    this.name = "JobVersionError";
  }
}

export function validateDurationMinutes(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < MIN_JOB_DURATION_MINUTES || value > MAX_JOB_DURATION_MINUTES) {
    throw new Error(
      `A visit length must be a whole number of minutes between ${MIN_JOB_DURATION_MINUTES} and ${MAX_JOB_DURATION_MINUTES}.`,
    );
  }
  return value;
}

export async function readDefaultJobMinutes(tx: Pick<Prisma.TransactionClient, "businessSettings">): Promise<number> {
  const settings = await tx.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { defaultJobDurationMinutes: true },
  });
  return settings?.defaultJobDurationMinutes ?? FALLBACK_JOB_DURATION_MINUTES;
}

/** Lock the given users in id order (FOR UPDATE). Always the first locks a scheduling command takes. */
export async function lockUsersForScheduling(
  tx: Prisma.TransactionClient,
  userIds: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0))].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`
    SELECT "id" FROM "User" WHERE "id" = ANY(${ids}) ORDER BY "id" FOR UPDATE
  `;
}

async function assertAssignable(tx: Prisma.TransactionClient, assigneeUserId: string) {
  const user = await tx.user.findUnique({
    where: { id: assigneeUserId },
    select: { role: true, archivedAt: true },
  });
  if (!user || user.archivedAt || !["OWNER", "ADMIN", "STAFF"].includes(user.role)) {
    throw new Error("Choose an active team member to do this visit.");
  }
}

/**
 * Other scheduled or in-progress visits for the same person that overlap `interval`.
 * Must run inside the transaction that already holds the assignee's User lock.
 * The SQL narrows candidates (anything that started before this visit ends and no
 * more than the maximum visit length before it starts); the exact overlap is decided in code.
 */
export async function findAssigneeConflicts(
  tx: Prisma.TransactionClient,
  args: { assigneeUserId: string; interval: JobInterval; excludeJobId: string | null; defaultMinutes: number },
): Promise<JobConflict[]> {
  const rows = await tx.$queryRaw<Array<{ id: string; type: JobType; scheduledAt: Date; durationMinutes: number | null }>>`
    SELECT j."id", j."type", j."scheduledAt", j."durationMinutes"
    FROM "Job" j
    WHERE j."assignedToUserId" = ${args.assigneeUserId}
      AND j."status" IN ('SCHEDULED','IN_PROGRESS')
      AND j."scheduledAt" IS NOT NULL
      AND j."scheduledAt" < ${args.interval.end}::timestamptz
      AND j."scheduledAt" >= ${args.interval.start}::timestamptz - INTERVAL '720 minutes'
      AND (${args.excludeJobId}::text IS NULL OR j."id" <> ${args.excludeJobId})
    ORDER BY j."scheduledAt", j."id"
  `;
  const overlapping = rows.filter((row) =>
    intervalsOverlap(jobInterval({ scheduledAt: row.scheduledAt, durationMinutes: row.durationMinutes }, args.defaultMinutes), args.interval),
  );
  if (overlapping.length === 0) return [];
  const names = await tx.job.findMany({
    where: { id: { in: overlapping.map((row) => row.id) } },
    select: { id: true, customer: { select: { user: { select: { name: true, email: true } } } } },
  });
  const nameById = new Map(names.map((n) => [n.id, n.customer ? (n.customer.user.name ?? n.customer.user.email) : null]));
  return overlapping.map((row) => ({
    jobId: row.id,
    type: row.type,
    scheduledAt: row.scheduledAt,
    durationMinutes: row.durationMinutes,
    customerName: nameById.get(row.id) ?? null,
  }));
}

/**
 * Under the lock: compute the current conflicts and require that every one of them was confirmed
 * by the person. A yes given for visit X can never approve a later conflict with visit Y.
 */
export async function checkConfirmedConflicts(
  tx: Prisma.TransactionClient,
  args: {
    assigneeUserId: string | null;
    scheduledAt: Date | null;
    durationMinutes: number | null;
    excludeJobId: string | null;
    confirmedConflictJobIds: readonly string[];
  },
): Promise<string[]> {
  if (!args.assigneeUserId || !args.scheduledAt) return [];
  const defaultMinutes = await readDefaultJobMinutes(tx);
  const conflicts = await findAssigneeConflicts(tx, {
    assigneeUserId: args.assigneeUserId,
    interval: jobInterval({ scheduledAt: args.scheduledAt, durationMinutes: args.durationMinutes }, defaultMinutes),
    excludeJobId: args.excludeJobId,
    defaultMinutes,
  });
  const confirmed = new Set(args.confirmedConflictJobIds);
  if (conflicts.some((c) => !confirmed.has(c.jobId))) {
    throw new JobScheduleConflictError(conflicts);
  }
  return conflicts.map((c) => c.jobId);
}

export type ScheduleJobInput = {
  jobId: string;
  expectedVersion: number;
  scheduledAt: Date;
  durationMinutes: number | null;
  assignedToUserId: string | null;
  confirmedConflictJobIds: readonly string[];
};

export async function scheduleJob(
  userId: string,
  input: ScheduleJobInput,
): Promise<{ jobId: string; version: number; overriddenConflictJobIds: string[] }> {
  if (!(input.scheduledAt instanceof Date) || Number.isNaN(input.scheduledAt.getTime())) {
    throw new Error("Choose a valid date and time for this visit.");
  }
  const durationMinutes = validateDurationMinutes(input.durationMinutes);

  return prisma.$transaction(async (tx) => {
    // Read the current assignee without a lock only to know which people to lock; re-verified below.
    const peek = await tx.job.findUnique({ where: { id: input.jobId }, select: { assignedToUserId: true } });
    if (!peek) throw new Error("Couldn't find that job.");

    await lockUsersForScheduling(tx, [userId, peek.assignedToUserId, input.assignedToUserId]);
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    if (input.assignedToUserId) await assertAssignable(tx, input.assignedToUserId);

    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Job" WHERE "id" = ${input.jobId} FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error("Couldn't find that job.");
    const before = await tx.job.findUniqueOrThrow({
      where: { id: input.jobId },
      select: { status: true, version: true, scheduledAt: true, durationMinutes: true, assignedToUserId: true },
    });
    if (before.version !== input.expectedVersion || before.assignedToUserId !== peek.assignedToUserId) {
      throw new JobVersionError();
    }
    if (before.status !== "SCHEDULED" && before.status !== "IN_PROGRESS") {
      throw new Error("Only a job that is scheduled or in progress can be rescheduled.");
    }

    const overriddenConflictJobIds = await checkConfirmedConflicts(tx, {
      assigneeUserId: input.assignedToUserId,
      scheduledAt: input.scheduledAt,
      durationMinutes,
      excludeJobId: input.jobId,
      confirmedConflictJobIds: input.confirmedConflictJobIds,
    });

    const updated = await tx.job.updateMany({
      where: { id: input.jobId, version: input.expectedVersion },
      data: {
        scheduledAt: input.scheduledAt,
        durationMinutes,
        assignedToUserId: input.assignedToUserId,
        version: { increment: 1 },
        // A visit moved to another Colorado day needs its day-of reminder again; a time change within the same day keeps it.
        ...(before.scheduledAt && businessDateKey(before.scheduledAt) === businessDateKey(input.scheduledAt)
          ? {}
          : { dayOfReminderSentAt: null }),
      },
    });
    if (updated.count !== 1) throw new JobVersionError();

    await tx.auditLog.create({
      data: {
        userId,
        action: "job.schedule",
        entityType: "Job",
        entityId: input.jobId,
        oldValue: {
          scheduledAt: before.scheduledAt?.toISOString() ?? null,
          durationMinutes: before.durationMinutes,
          assignedToUserId: before.assignedToUserId,
        },
        newValue: {
          scheduledAt: input.scheduledAt.toISOString(),
          durationMinutes,
          assignedToUserId: input.assignedToUserId,
          overriddenConflictJobIds,
        },
      },
    });

    return { jobId: input.jobId, version: input.expectedVersion + 1, overriddenConflictJobIds };
  });
}

/**
 * Nobody was there. The visit is cancelled and marked as a no-show; it frees the person's time and
 * changes nothing else: no appliance status, custody, assignment, pending delivery, credit, invoice
 * line or billing handoff. Owner/admin, or the staff member the job is assigned to.
 */
export async function markJobNoShow(userId: string, jobId: string, expectedVersion: number): Promise<{ version: number }> {
  return prisma.$transaction(async (tx) => {
    await lockUsersForScheduling(tx, [userId]);
    const actor = await assertActiveTeamActor(tx, userId);
    await assertJobScopeInTx(tx, { userId, role: actor.role as TeamRole }, { jobId, write: "STATUS" });

    const peeked = await tx.job.findUnique({ where: { id: jobId }, select: { maintenanceRequestId: true } });
    if (peeked?.maintenanceRequestId) await lockMaintenanceRequestInTx(tx, peeked.maintenanceRequestId);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Job" WHERE "id" = ${jobId} FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error("Couldn't find that job.");
    const job = await tx.job.findUniqueOrThrow({
      where: { id: jobId },
      select: { status: true, version: true, assignedToUserId: true, type: true, maintenanceRequestId: true },
    });
    if (job.version !== expectedVersion) throw new JobVersionError();
    if (job.status !== "SCHEDULED" && job.status !== "IN_PROGRESS") {
      throw new Error("Only a job that is scheduled or in progress can be marked as a no-show.");
    }

    const result = await tx.job.updateMany({
      where: { id: jobId, version: expectedVersion },
      data: { status: "CANCELLED", noShowAt: new Date(), version: { increment: 1 } },
    });
    if (result.count !== 1) throw new JobVersionError();
    await releaseSwapReservationsInTx(tx, userId, jobId, "Swap visit was a no-show");
    if (job.maintenanceRequestId && job.type === "MAINTENANCE_VISIT") {
      await requestAfterVisitEndedInTx(tx, userId, job.maintenanceRequestId, jobId, "CANCELLED");
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: "job.noShow",
        entityType: "Job",
        entityId: jobId,
        oldValue: { status: job.status },
        newValue: { status: "CANCELLED", noShow: true },
      },
    });
    return { version: expectedVersion + 1 };
  });
}
