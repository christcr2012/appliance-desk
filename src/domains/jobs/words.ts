import type { JobStatus, MaintenanceStatus } from "@prisma/client";
import { formatBusinessTime, relativeBusinessDay } from "@/lib/business-date";
import { jobTypeLabel, maintenancePriorityLabel } from "@/lib/status-labels";

/**
 * AR-5 section 2: the shared words for visits and repair requests. Pure — no database, no session.
 * The pill tones are the kit's Tone vocabulary (src/components/kit/types) spelled out here so the
 * domain stays free of component imports; the shapes are assignable to the kit StatusPill props.
 */
export type PillTone = "info" | "attention" | "good" | "neutral" | "danger";
export type PillSpec = { label: string; tone: PillTone };

type VisitWordsJob = {
  type: string;
  scheduledAt: Date | null;
  customer?: { user?: { name?: string | null } | null } | null;
};

/** "{jobTypeLabel} · {customer name or 'No customer'}" — the one-line name of a visit everywhere. */
export function visitTitle(job: VisitWordsJob): string {
  return `${jobTypeLabel(job.type)} · ${job.customer?.user?.name ?? "No customer"}`;
}

/** "{relative day} at {Denver time}", or "No time yet" when the visit has no time. */
export function visitWhen(job: { scheduledAt: Date | null }, now: Date = new Date()): string {
  if (!job.scheduledAt) return "No time yet";
  return `${relativeBusinessDay(job.scheduledAt, now)} at ${formatBusinessTime(job.scheduledAt)}`;
}

export const VISIT_PILL: Record<JobStatus, PillSpec> = {
  SCHEDULED: { label: "Booked", tone: "info" },
  IN_PROGRESS: { label: "Under way", tone: "attention" },
  COMPLETED: { label: "Done", tone: "good" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

/** A no-show (noShowAt set) reads "Nobody home" instead of its status pill. */
export function visitPill(job: { status: JobStatus; noShowAt?: Date | null }): PillSpec {
  if (job.noShowAt) return { label: "Nobody home", tone: "attention" };
  return VISIT_PILL[job.status];
}

export const REPAIR_PILL: Record<MaintenanceStatus, PillSpec> = {
  SUBMITTED: { label: "New", tone: "attention" },
  REVIEWING: { label: "Looking at it", tone: "info" },
  SCHEDULED: { label: "Visit booked", tone: "info" },
  IN_PROGRESS: { label: "Being fixed", tone: "attention" },
  RESOLVED: { label: "Fixed", tone: "good" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

/**
 * Priority chips appear only in a repair's detail line: URGENT is danger, HIGH is attention,
 * NORMAL and LOW get no chip (null).
 */
export function repairPriorityChip(priority: string): PillSpec | null {
  if (priority === "URGENT") return { label: maintenancePriorityLabel(priority), tone: "danger" };
  if (priority === "HIGH") return { label: maintenancePriorityLabel(priority), tone: "attention" };
  return null;
}
