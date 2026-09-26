"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { createJob, updateJobStatus, addJobPhoto } from "@/domains/jobs";
import type { JobStatus, JobType } from "@prisma/client";

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
});

export async function createJobAction(
  raw: Record<string, unknown>,
): Promise<{ status: "success"; jobId: string } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newJobSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }
  const data = parsed.data;

  const job = await createJob(session.user.id, {
    type: data.type,
    scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
    customerId: data.customerId || null,
    serviceAddressId: data.serviceAddressId || null,
    agreementId: data.agreementId || null,
    maintenanceRequestId: data.maintenanceRequestId || null,
    applianceIds: data.applianceIds ?? [],
    notes: data.notes || null,
  });

  revalidatePath("/desk/jobs");
  revalidatePath("/desk/dashboard");
  if (data.agreementId) revalidatePath(`/desk/agreements/${data.agreementId}`);
  if (data.maintenanceRequestId) revalidatePath(`/desk/maintenance/${data.maintenanceRequestId}`);

  return { status: "success", jobId: job.id };
}

export async function updateJobStatusAction(
  jobId: string,
  status: string,
  completionNotes?: string,
): Promise<JobActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  if (!ALL_JOB_STATUSES.includes(status as JobStatus)) {
    return { status: "error", message: "That's not a valid status." };
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
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = photoSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }
  const data = parsed.data;

  await addJobPhoto(session.user.id, jobId, {
    url: data.url,
    altText: data.altText || null,
  });

  revalidatePath(`/desk/jobs/${jobId}`);
  return { status: "success" };
}
