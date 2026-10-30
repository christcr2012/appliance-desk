import type { JobStatus, JobType } from "@prisma/client";
import { relativeBusinessDay } from "@/lib/business-date";

/**
 * AR-5 section 6: the visit record's one next step, as a pure reading of the visit's state.
 * The page gathers the facts that are not on the job row (an open follow-up task, a closed
 * rental, an unrefunded deposit) and passes them in; this function only decides the words.
 * Money steps are OWNER/ADMIN only — a staff member never sees the deposit step.
 */
export type VisitNextStep = { label: string; cta: string; href: string };

export type NextStepJob = {
  status: JobStatus;
  type: JobType;
  scheduledAt: Date | null;
  assignedToUserId: string | null;
  hasOpenFollowUp?: boolean;
  rentalClosed?: boolean;
  depositId?: string | null;
};

export function visitNextStep(
  job: NextStepJob,
  scope: { role: "OWNER" | "ADMIN" | "STAFF" },
  now: Date = new Date(),
): VisitNextStep | null {
  const ownerOrAdmin = scope.role === "OWNER" || scope.role === "ADMIN";
  const active = job.status === "SCHEDULED" || job.status === "IN_PROGRESS";

  if (active && !job.scheduledAt) {
    return { label: "This visit has no time yet.", cta: "Set a time", href: "#schedule" };
  }
  if (active && job.scheduledAt && !job.assignedToUserId && ownerOrAdmin) {
    return {
      label: "Nobody is assigned to this visit yet.",
      cta: "Choose who goes",
      href: "#schedule",
    };
  }
  if (job.status === "SCHEDULED" && job.scheduledAt && relativeBusinessDay(job.scheduledAt, now) === "today") {
    return { label: "This visit is today.", cta: "Start the visit", href: "#finish" };
  }
  if (job.status === "IN_PROGRESS") {
    return { label: "This visit is under way.", cta: "Finish the visit", href: "#finish" };
  }
  if (job.status === "COMPLETED" && job.hasOpenFollowUp) {
    return {
      label: "Some items weren't done — a follow-up task was added.",
      cta: "Open tasks",
      href: "/desk/tasks",
    };
  }
  if (
    job.status === "COMPLETED" &&
    job.type === "REMOVAL" &&
    job.rentalClosed &&
    job.depositId &&
    ownerOrAdmin
  ) {
    return {
      label: "The rental is closed. The deposit still needs settling.",
      cta: "Settle the deposit",
      href: `/desk/billing/deposits/${job.depositId}`,
    };
  }
  return null;
}
