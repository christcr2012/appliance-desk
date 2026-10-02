"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  createJob,
  updateJobStatus,
  addJobPhoto,
  setJobRepairCosts,
  updateJobChecklist,
} from "@/domains/jobs";
import { updateApplianceStatus } from "@/domains/inventory";
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
});

export async function createJobAction(
  raw: Record<string, unknown>,
): Promise<
  { status: "success"; jobId: string } | { status: "error"; message: string }
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

  let job;
  try {
    job = await createJob(session.user.id, {
      type: data.type,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      customerId: data.customerId || null,
      serviceAddressId: data.serviceAddressId || null,
      agreementId: data.agreementId || null,
      maintenanceRequestId: data.maintenanceRequestId || null,
      applianceIds: data.applianceIds ?? [],
      notes: data.notes || null,
    });
  } catch (error) {
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

export async function updateJobStatusAction(
  jobId: string,
  status: string,
  completionNotes?: string,
): Promise<JobActionState> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");

  if (!ALL_JOB_STATUSES.includes(status as JobStatus)) {
    return { status: "error", message: "That's not a valid status." };
  }

  try {
    await updateJobStatus(
      session.user.id,
      jobId,
      status as JobStatus,
      completionNotes,
    );
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
    }
    await updateApplianceStatus(
      session.user.id,
      applianceId,
      status as ApplianceStatus,
    );
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
