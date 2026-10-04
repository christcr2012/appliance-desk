"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  createJob,
  updateJobStatus,
  completeJob,
  addJobPhoto,
  setJobRepairCosts,
  updateJobChecklist,
} from "@/domains/jobs";
import {
  JobScheduleConflictError,
  JobVersionError,
  markJobNoShow,
  scheduleJob,
  type JobConflict,
} from "@/domains/jobs/scheduling";
import { businessDateTimeFromLocal } from "@/lib/business-date";
import { parsePerformedOn } from "@/domains/billing/pickup-billing-events";
import { updateApplianceStatus } from "@/domains/inventory";
import { scheduleMaintenanceRequest } from "@/domains/maintenance";
import { updateApplianceStatusAsTeamActor } from "@/domains/inventory/guarded-status";
import type { JobStatus, JobType, ApplianceStatus } from "@prisma/client";
import { ALL_APPLIANCE_STATUSES } from "@/domains/inventory/lifecycle";

export type JobActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

const ALL_JOB_TYPES: JobType[] = [
  "DELIVERY",
  "INSTALLATION",
  "SWAP",
  "MAINTENANCE_VISIT",
  "REMOVAL",
];
const ALL_JOB_STATUSES: JobStatus[] = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];

const newJobSchema = z.object({
  type: z.enum(ALL_JOB_TYPES as [JobType, ...JobType[]]),
  scheduledAt: z.string().trim().optional().or(z.literal("")),
  customerId: z.string().trim().optional().or(z.literal("")),
  serviceAddressId: z.string().trim().optional().or(z.literal("")),
  agreementId: z.string().trim().optional().or(z.literal("")),
  maintenanceRequestId: z.string().trim().optional().or(z.literal("")),
  applianceIds: z.array(z.string().trim().min(1)).optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  assignedToUserId: z.string().trim().max(64).optional().or(z.literal("")),
  durationMinutes: z.number().int().min(15).max(720).nullable().optional(),
  confirmedConflictJobIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

/** What the screen needs to show a double-booking and let the person confirm that exact list. */
export type ScheduleConflictView = {
  jobId: string;
  type: string;
  scheduledAt: string;
  durationMinutes: number | null;
  customerName: string | null;
};

function conflictViews(conflicts: JobConflict[]): ScheduleConflictView[] {
  return conflicts.map((c) => ({
    jobId: c.jobId,
    type: c.type,
    scheduledAt: c.scheduledAt.toISOString(),
    durationMinutes: c.durationMinutes,
    customerName: c.customerName,
  }));
}

export type ScheduleActionResult =
  | { status: "success"; jobId?: string }
  | { status: "conflict"; message: string; conflicts: ScheduleConflictView[] }
  | { status: "error"; message: string };

export async function createJobAction(
  raw: Record<string, unknown>,
): Promise<
  | { status: "success"; jobId: string }
  | { status: "conflict"; message: string; conflicts: ScheduleConflictView[] }
  | { status: "error"; message: string }
> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newJobSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }
  const data = parsed.data;
  // The date-time box is Colorado clock time, never the server's own time zone.
  const scheduledAt = data.scheduledAt ? businessDateTimeFromLocal(data.scheduledAt) : null;
  if (data.scheduledAt && !scheduledAt) {
    return { status: "error", message: "Choose a valid date and time (that time may not exist on a clock-change day)." };
  }

  let job;
  try {
    if (data.type === "MAINTENANCE_VISIT" && data.maintenanceRequestId) {
      // A repair visit for a request is scheduled with the request itself, so both change together.
      if (!scheduledAt) return { status: "error", message: "Choose a date and time for the repair visit." };
      if (!data.serviceAddressId) return { status: "error", message: "Choose the property this visit is for." };
      const scheduled = await scheduleMaintenanceRequest(session.user.id, {
        requestId: data.maintenanceRequestId,
        scheduledAt,
        durationMinutes: data.durationMinutes ?? null,
        assignedToUserId: data.assignedToUserId || null,
        serviceAddressId: data.serviceAddressId,
        confirmedConflictJobIds: data.confirmedConflictJobIds ?? [],
      });
      revalidatePath("/desk/jobs");
      revalidatePath("/desk/dashboard");
      revalidatePath("/desk/maintenance");
      revalidatePath(`/desk/maintenance/${data.maintenanceRequestId}`);
      return { status: "success", jobId: scheduled.jobId };
    }
    job = await createJob(session.user.id, {
      type: data.type,
      scheduledAt,
      assignedToUserId: data.assignedToUserId || null,
      durationMinutes: data.durationMinutes ?? null,
      confirmedConflictJobIds: data.confirmedConflictJobIds ?? [],
      customerId: data.customerId || null,
      serviceAddressId: data.serviceAddressId || null,
      agreementId: data.agreementId || null,
      maintenanceRequestId: data.maintenanceRequestId || null,
      applianceIds: data.applianceIds ?? [],
      notes: data.notes || null,
    });
  } catch (error) {
    if (error instanceof JobScheduleConflictError) {
      return { status: "conflict", message: error.message, conflicts: conflictViews(error.conflicts) };
    }
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Couldn't create this visit.",
    };
  }

  revalidatePath("/desk/jobs");
  revalidatePath("/desk/dashboard");
  if (data.agreementId) revalidatePath(`/desk/agreements/${data.agreementId}`);
  if (data.maintenanceRequestId)
    revalidatePath(`/desk/maintenance/${data.maintenanceRequestId}`);

  return { status: "success", jobId: job.id };
}

/** Start or cancel a job. Completing one is `completeJobAction`: every appliance needs its own result. */
export async function updateJobStatusAction(
  jobId: string,
  status: string,
  completionNotes?: string,
): Promise<JobActionState> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");

  if (!ALL_JOB_STATUSES.includes(status as JobStatus)) {
    return { status: "error", message: "That's not a valid status." };
  }
  if (status === "COMPLETED") {
    return { status: "error", message: "Use Complete job so each appliance gets a result." };
  }

  try {
    await updateJobStatus(session.user.id, jobId, status as JobStatus, completionNotes);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't update that job.",
    };
  }

  revalidatePath("/desk/jobs");
  revalidatePath(`/desk/jobs/${jobId}`);
  revalidatePath("/desk/dashboard");
  revalidatePath("/desk/activity");
  revalidatePath("/desk/today");
  return { status: "success" };
}

const RESULT_VALUES = ["DELIVERED", "NOT_DELIVERED", "RETURNED", "NOT_RETURNED", "REPAIRED", "NOT_REPAIRED", "NO_ACCESS"] as const;
const completeJobSchema = z.object({
  expectedVersion: z.number().int().min(1).max(2147483646),
  completionKey: z.string().trim().min(8).max(100),
  performedOn: z.string().trim().max(10).optional().or(z.literal("")),
  completionNotes: z.string().max(2000).optional().or(z.literal("")),
  results: z
    .array(
      z.object({
        applianceId: z.string().trim().min(1).max(64),
        result: z.enum(RESULT_VALUES),
        note: z.string().max(500).optional().or(z.literal("")),
      }),
    )
    .max(200),
});

/** Complete a job: one result for every appliance on the visit, plus the date the work was done. */
export async function completeJobAction(jobId: string, raw: Record<string, unknown>): Promise<JobActionState> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  if (typeof jobId !== "string" || jobId.length === 0 || jobId.length > 64) {
    return { status: "error", message: "Couldn't find that job." };
  }
  const parsed = completeJobSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the results and try again." };
  }
  const data = parsed.data;
  const performed = parsePerformedOn(data.performedOn);
  if (!performed.ok) return { status: "error", message: performed.message };

  try {
    await completeJob(session.user.id, {
      jobId,
      expectedVersion: data.expectedVersion,
      completionKey: data.completionKey,
      performedOn: performed.value,
      completionNotes: data.completionNotes || null,
      results: data.results.map((r) => ({ applianceId: r.applianceId, result: r.result, note: r.note || undefined })),
    });
  } catch (error) {
    if (error instanceof JobVersionError) {
      return { status: "error", message: "This job was just changed by someone else. Reload the page and check it before completing." };
    }
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't complete that job." };
  }

  revalidatePath("/desk/jobs");
  revalidatePath(`/desk/jobs/${jobId}`);
  revalidatePath("/desk/dashboard");
  revalidatePath("/desk/activity");
  revalidatePath("/desk/today");
  revalidatePath("/desk/tasks");
  revalidatePath("/desk/inventory");
  return { status: "success" };
}

/** Owner/admin: take a never-delivered item off its agreement and credit everything billed for it. */
export async function removeUndeliveredItemAction(pendingDeliveryId: string, jobId: string): Promise<JobActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  if (typeof pendingDeliveryId !== "string" || pendingDeliveryId.length === 0 || pendingDeliveryId.length > 64) {
    return { status: "error", message: "Couldn't find that waiting item." };
  }
  try {
    const { removeUndeliveredItem } = await import("@/domains/billing/pickup-billing-events");
    await removeUndeliveredItem(session.user.id, pendingDeliveryId);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't remove that item." };
  }
  revalidatePath(`/desk/jobs/${jobId}`);
  revalidatePath("/desk/today");
  revalidatePath("/desk/inventory");
  return { status: "success" };
}

const photoSchema = z.object({
  url: z.string().trim().url("Enter a valid photo URL.").max(2000),
  altText: z.string().trim().max(300).optional().or(z.literal("")),
});

export async function addJobPhotoAction(
  jobId: string,
  raw: Record<string, unknown>,
): Promise<JobActionState> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");

  const parsed = photoSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }
  const data = parsed.data;

  try {
    await addJobPhoto(session.user.id, jobId, {
      url: data.url,
      altText: data.altText || null,
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't add that photo.",
    };
  }

  revalidatePath(`/desk/jobs/${jobId}`);
  return { status: "success" };
}

const repairCostSchema = z.object({
  partsCostDollars: z.string().trim().optional().or(z.literal("")),
  laborCostDollars: z.string().trim().optional().or(z.literal("")),
});

function dollarsToCentsOrNull(raw: string | undefined): number | null {
  if (!raw || raw.trim() === "") return null;
  const dollars = Number(raw);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

export async function setJobRepairCostsAction(
  jobId: string,
  raw: Record<string, unknown>,
): Promise<JobActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = repairCostSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }

  try {
    await setJobRepairCosts(session.user.id, jobId, {
      partsCostCents: dollarsToCentsOrNull(parsed.data.partsCostDollars),
      laborCostCents: dollarsToCentsOrNull(parsed.data.laborCostDollars),
    });
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Couldn't update repair costs.",
    };
  }

  revalidatePath(`/desk/jobs/${jobId}`);
  revalidatePath("/desk/fleet");
  revalidatePath("/desk/dashboard");
  return { status: "success" };
}

export async function updateApplianceStatusFromJobAction(
  applianceId: string,
  status: string,
  jobId?: string,
): Promise<JobActionState> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");

  if (!ALL_APPLIANCE_STATUSES.includes(status as ApplianceStatus)) {
    return { status: "error", message: "That's not a valid status." };
  }

  try {
    if (session.user.role === "STAFF") {
      if (
        !jobId ||
        !(await prisma.jobAppliance.findFirst({
          where: { jobId, applianceId },
          select: { id: true },
        }))
      ) {
        return {
          status: "error",
          message: "This appliance is not linked to the originating job.",
        };
      }
      await updateApplianceStatusAsTeamActor(
        session.user.id,
        applianceId,
        status as ApplianceStatus,
      );
    } else {
      await updateApplianceStatus(
        session.user.id,
        applianceId,
        status as ApplianceStatus,
      );
    }
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Couldn't update that appliance.",
    };
  }

  revalidatePath("/desk/inventory");
  revalidatePath(`/desk/inventory/${applianceId}`);
  revalidatePath("/desk/dashboard");
  revalidatePath("/desk/fleet");
  if (jobId) revalidatePath(`/desk/jobs/${jobId}`);
  return { status: "success" };
}

const checklistItemSchema = z.object({
  item: z.string().trim().min(1).max(300),
  checked: z.boolean(),
});

export async function updateJobChecklistAction(
  jobId: string,
  checklist: unknown,
): Promise<JobActionState> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");

  const parsed = z.array(checklistItemSchema).safeParse(checklist);
  if (!parsed.success) {
    return {
      status: "error",
      message: "That checklist wasn't in a format we could save.",
    };
  }

  try {
    await updateJobChecklist(session.user.id, jobId, parsed.data);
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Couldn't update that checklist.",
    };
  }

  revalidatePath(`/desk/jobs/${jobId}`);
  revalidatePath("/desk/dispatch");
  revalidatePath("/desk/activity");
  return { status: "success" };
}

const scheduleSchema = z.object({
  jobId: z.string().trim().min(1).max(64),
  expectedVersion: z.number().int().min(1),
  scheduledAt: z.string().trim().min(1),
  durationMinutes: z.number().int().min(15).max(720).nullable(),
  assignedToUserId: z.string().trim().max(64).nullable(),
  confirmedConflictJobIds: z.array(z.string().trim().min(1).max(64)).max(50),
});

/** Owner/admin: change when a visit happens, how long it takes and who does it. */
export async function scheduleJobAction(raw: Record<string, unknown>): Promise<ScheduleActionResult> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = scheduleSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Please check the fields and try again." };
  }
  const when = businessDateTimeFromLocal(parsed.data.scheduledAt);
  if (!when) {
    return { status: "error", message: "Choose a valid date and time (that time may not exist on a clock-change day)." };
  }
  try {
    await scheduleJob(session.user.id, {
      jobId: parsed.data.jobId,
      expectedVersion: parsed.data.expectedVersion,
      scheduledAt: when,
      durationMinutes: parsed.data.durationMinutes,
      assignedToUserId: parsed.data.assignedToUserId || null,
      confirmedConflictJobIds: parsed.data.confirmedConflictJobIds,
    });
  } catch (error) {
    if (error instanceof JobScheduleConflictError) {
      return { status: "conflict", message: error.message, conflicts: conflictViews(error.conflicts) };
    }
    if (error instanceof JobVersionError) return { status: "error", message: error.message };
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't reschedule that visit." };
  }
  revalidatePath("/desk/jobs");
  revalidatePath(`/desk/jobs/${parsed.data.jobId}`);
  revalidatePath("/desk/dispatch");
  revalidatePath("/desk/today");
  return { status: "success" };
}

/** Nobody was there: cancel the visit and mark it as a no-show. Nothing else changes. */
export async function markJobNoShowAction(jobId: string, expectedVersion: number): Promise<JobActionState> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  if (typeof jobId !== "string" || jobId.length === 0 || jobId.length > 64 || !Number.isInteger(expectedVersion)) {
    return { status: "error", message: "Couldn't find that job." };
  }
  try {
    await markJobNoShow(session.user.id, jobId, expectedVersion);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't mark that visit." };
  }
  revalidatePath("/desk/jobs");
  revalidatePath(`/desk/jobs/${jobId}`);
  revalidatePath("/desk/dispatch");
  revalidatePath("/desk/today");
  return { status: "success" };
}
