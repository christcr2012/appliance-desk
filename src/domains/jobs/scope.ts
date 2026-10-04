import type { Prisma } from "@prisma/client";
import type { JobStatus, JobType } from "@prisma/client";
import type { TeamRole } from "@/lib/team-actor";

export type JobScopeWrite = "COMPLETE" | "STATUS" | "PHOTO" | "CHECKLIST" | "INSPECTION" | "SWAP_STATUS";

export type JobScopeResult = {
  jobId: string;
  status: JobStatus;
  type: JobType;
  assignedToUserId: string | null;
};

/**
 * Which jobs a staff member may work on (Batch C P2-E). Call it inside the write's own transaction, right after
 * `assertActiveTeamActor`, so the person's role and the job's state are checked at the same moment as the write.
 *
 * Owners and admins may touch any job. A staff member may work a job only when:
 *   - the job is scheduled or in progress (photos may also be added after it is completed),
 *   - it is assigned to them, or it is assigned to nobody and the owner's setting
 *     "Can staff work jobs nobody is assigned to?" is on, and
 *   - when an appliance is named, that appliance is on this job.
 */
export async function assertJobScopeInTx(
  tx: Prisma.TransactionClient,
  actor: { userId: string; role: TeamRole },
  args: { jobId: string; applianceId?: string; write: JobScopeWrite },
): Promise<JobScopeResult> {
  const job = await tx.job.findUnique({
    where: { id: args.jobId },
    select: { id: true, status: true, type: true, assignedToUserId: true },
  });
  if (!job) throw new Error("Couldn't find that job.");
  const result: JobScopeResult = {
    jobId: job.id,
    status: job.status,
    type: job.type,
    assignedToUserId: job.assignedToUserId,
  };
  if (actor.role === "OWNER" || actor.role === "ADMIN") return result;

  const openStatuses: JobStatus[] = ["SCHEDULED", "IN_PROGRESS"];
  const allowedStatuses: JobStatus[] = args.write === "PHOTO" ? [...openStatuses, "COMPLETED"] : openStatuses;
  if (!allowedStatuses.includes(job.status)) {
    throw new Error("Staff can only work on a job that is scheduled or in progress.");
  }

  if (job.assignedToUserId !== actor.userId) {
    if (job.assignedToUserId !== null) {
      throw new Error("This job is assigned to someone else. Ask an owner or admin.");
    }
    const settings = await tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { staffMayWorkUnassignedJobs: true },
    });
    if (!(settings?.staffMayWorkUnassignedJobs ?? true)) {
      throw new Error("Staff can only work on jobs assigned to them. Ask an owner or admin to assign this one.");
    }
  }

  if (args.applianceId) {
    const linked = await tx.jobAppliance.findFirst({
      where: { jobId: job.id, applianceId: args.applianceId },
      select: { id: true },
    });
    if (!linked) throw new Error("This appliance is not linked to the originating job.");
  }
  return result;
}
