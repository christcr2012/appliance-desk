"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { createTask, completeTask, reopenTask, deleteTask } from "@/domains/tasks";

const newTaskSchema = z.object({
  note: z.string().trim().min(1, "Give this task a short note.").max(500),
  dueDate: z.string().trim().optional().or(z.literal("")),
  leadId: z.string().trim().optional().or(z.literal("")),
  customerId: z.string().trim().optional().or(z.literal("")),
  jobId: z.string().trim().optional().or(z.literal("")),
});

// Tasks are a personal-organization tool for whoever's working the
// desk — no financial data involved — so OWNER/ADMIN/STAFF can all use
// them, unlike the OWNER/ADMIN-only estimate/lead actions.
export async function createTaskAction(
  raw: Record<string, unknown>,
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");

  const parsed = newTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }
  const data = parsed.data;

  try {
    await createTask(session.user.id, {
      note: data.note,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      leadId: data.leadId || null,
      customerId: data.customerId || null,
      jobId: data.jobId || null,
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't save that task.",
    };
  }

  revalidatePath("/desk/tasks");
  if (data.leadId) revalidatePath(`/desk/leads/${data.leadId}`);
  if (data.customerId) revalidatePath(`/desk/customers/${data.customerId}`);
  return { status: "success" };
}

export async function completeTaskAction(taskId: string): Promise<void> {
  await requireRole("OWNER", "ADMIN", "STAFF");
  await completeTask(taskId);
  revalidatePath("/desk/tasks");
}

export async function reopenTaskAction(taskId: string): Promise<void> {
  await requireRole("OWNER", "ADMIN", "STAFF");
  await reopenTask(taskId);
  revalidatePath("/desk/tasks");
}

export async function deleteTaskAction(taskId: string): Promise<void> {
  await requireRole("OWNER", "ADMIN", "STAFF");
  await deleteTask(taskId);
  revalidatePath("/desk/tasks");
}
