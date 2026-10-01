"use server";

import { revalidatePath } from "next/cache";
import {
  createTask,
  updateTask,
  completeTask,
  reopenTask,
  deleteTask,
} from "@/domains/tasks";
import { TaskError, taskInputSchema } from "@/domains/tasks/validation";
export type TaskActionResult =
  { status: "success" } | { status: "error" | "conflict"; message: string };
function refreshTasks() {
  revalidatePath("/desk/tasks");
  revalidatePath("/desk/today");
  revalidatePath("/desk/customers", "layout");
  revalidatePath("/desk/leads", "layout");
}
async function run(action: () => Promise<unknown>): Promise<TaskActionResult> {
  try {
    await action();
  } catch (error) {
    return {
      status:
        error instanceof TaskError && error.conflict ? "conflict" : "error",
      message:
        error instanceof TaskError
          ? error.message
          : "Couldn't confirm this change. Your text is preserved. Reload the list before trying again.",
    };
  }
  refreshTasks();
  return { status: "success" };
}
export async function createTaskAction(
  raw: Record<string, unknown>,
): Promise<TaskActionResult> {
  const parsed = taskInputSchema.safeParse(raw);
  if (!parsed.success)
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the task fields.",
    };
  return run(() => createTask(parsed.data));
}
export async function updateTaskAction(
  id: string,
  version: number,
  raw: Record<string, unknown>,
): Promise<TaskActionResult> {
  const parsed = taskInputSchema.safeParse(raw);
  if (!parsed.success)
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the task fields.",
    };
  return run(() => updateTask(id, version, parsed.data));
}
export async function completeTaskAction(id: string, version: number) {
  return run(() => completeTask(id, version));
}
export async function reopenTaskAction(id: string, version: number) {
  return run(() => reopenTask(id, version));
}
export async function deleteTaskAction(id: string, version: number) {
  return run(() => deleteTask(id, version));
}
