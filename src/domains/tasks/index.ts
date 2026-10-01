import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import {
  taskInputSchema,
  taskVersionSchema,
  TaskError,
  type TaskInput,
} from "./validation";

const roles = ["OWNER", "ADMIN", "STAFF"] as const;
const userSelect = {
  id: true,
  name: true,
  email: true,
  archivedAt: true,
} as const;

/** Lock identity rows until commit: deactivation cannot race validation and write. */
async function activeStaff(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR SHARE`;
  const user = await tx.user.findFirst({
    where: { id: userId, archivedAt: null, role: { in: [...roles] } },
    select: { id: true, role: true },
  });
  if (!user) throw new TaskError("Choose an active team member.");
  return user;
}
function inputData(raw: TaskInput) {
  const parsed = taskInputSchema.safeParse(raw);
  if (!parsed.success)
    throw new TaskError(
      parsed.error.issues[0]?.message ?? "Check the task fields.",
    );
  const input = parsed.data;
  return {
    note: input.note,
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    priority: input.priority,
    assigneeUserId: input.assigneeUserId || null,
    leadId: input.leadId || null,
    customerId: input.customerId || null,
    jobId: input.jobId || null,
  };
}
async function validateLinks(
  tx: Prisma.TransactionClient,
  data: ReturnType<typeof inputData>,
  role: string,
) {
  if (data.assigneeUserId) await activeStaff(tx, data.assigneeUserId);
  if (
    data.leadId &&
    (role === "STAFF" ||
      !(await tx.lead.findUnique({
        where: { id: data.leadId },
        select: { id: true },
      })))
  ) {
    throw new TaskError("That linked record is unavailable.");
  }
  if (
    data.customerId &&
    !(await tx.customer.findFirst({
      where: { id: data.customerId, archivedAt: null },
      select: { id: true },
    }))
  ) {
    throw new TaskError("That linked record is unavailable.");
  }
  if (
    data.jobId &&
    !(await tx.job.findFirst({
      where: {
        id: data.jobId,
        OR: [{ customerId: null }, { customer: { archivedAt: null } }],
      },
      select: { id: true },
    }))
  ) {
    throw new TaskError("That linked record is unavailable.");
  }
}
function snapshot(task: {
  note: string;
  dueDate: Date | null;
  priority: string;
  assigneeUserId: string | null;
  version: number;
  completedAt: Date | null;
}) {
  return {
    note: task.note,
    dueDate: task.dueDate?.toISOString() ?? null,
    priority: task.priority,
    assigneeUserId: task.assigneeUserId,
    version: task.version,
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}
export async function getTaskAssignees() {
  await requireRole(...roles);
  return prisma.user.findMany({
    where: { archivedAt: null, role: { in: [...roles] } },
    select: userSelect,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}
export async function createTask(raw: TaskInput) {
  const session = await requireRole(...roles);
  const data = inputData(raw);
  return prisma.$transaction(async (tx) => {
    const actor = await activeStaff(tx, session.user.id);
    await validateLinks(tx, data, actor.role);
    const task = await tx.staffTask.create({
      data: { ...data, createdByUserId: actor.id },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "task.create",
        entityType: "StaffTask",
        entityId: task.id,
        newValue: snapshot(task),
      },
    });
    return task;
  });
}
export async function updateTask(id: string, version: number, raw: TaskInput) {
  const data = inputData(raw);
  return mutateTask(id, version, "update", data);
}
async function mutateTask(
  id: string,
  version: number,
  operation: "update" | "complete" | "reopen" | "delete",
  input?: ReturnType<typeof inputData>,
) {
  const session = await requireRole(...roles);
  if (!id || id.length > 200 || !taskVersionSchema.safeParse(version).success)
    throw new TaskError("Reload this task before changing it.", true);
  return prisma.$transaction(async (tx) => {
    const actor = await activeStaff(tx, session.user.id);
    const old = await tx.staffTask.findUnique({ where: { id } });
    if (!old)
      throw new TaskError(
        "This task is no longer available. Reload the list.",
        true,
      );
    // Repeating the same completion/reopen has no effects and adds no duplicate audit.
    if (
      (operation === "complete" && old.completedAt) ||
      (operation === "reopen" && !old.completedAt)
    )
      return;
    if (old.version !== version)
      throw new TaskError(
        "Someone changed this task. Your text is preserved; reload before saving again.",
        true,
      );
    if (input) {
      // Edits never change links; the task retains its original record context.
      await validateLinks(
        tx,
        { ...input, leadId: null, customerId: null, jobId: null },
        actor.role,
      );
    }
    const where = { id, version };
    if (operation === "delete") {
      if ((await tx.staffTask.deleteMany({ where })).count !== 1)
        throw new TaskError(
          "Someone changed this task. Reload before removing it.",
          true,
        );
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "task.delete",
          entityType: "StaffTask",
          entityId: id,
          oldValue: snapshot(old),
        },
      });
      return;
    }
    const data =
      operation === "update"
        ? {
            note: input!.note,
            dueDate: input!.dueDate,
            priority: input!.priority,
            assigneeUserId: input!.assigneeUserId,
          }
        : { completedAt: operation === "complete" ? new Date() : null };
    if (
      (
        await tx.staffTask.updateMany({
          where,
          data: { ...data, version: { increment: 1 } },
        })
      ).count !== 1
    )
      throw new TaskError(
        "Someone changed this task. Your text is preserved; reload before saving again.",
        true,
      );
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: `task.${operation}`,
        entityType: "StaffTask",
        entityId: id,
        oldValue: snapshot(old),
        newValue: snapshot({ ...old, ...data, version: version + 1 }),
      },
    });
  });
}
export async function completeTask(id: string, version: number) {
  return mutateTask(id, version, "complete");
}
export async function reopenTask(id: string, version: number) {
  return mutateTask(id, version, "reopen");
}
export async function deleteTask(id: string, version: number) {
  return mutateTask(id, version, "delete");
}
export async function getTasksForLead(leadId: string) {
  await requireRole("OWNER", "ADMIN");
  return prisma.staffTask.findMany({
    where: { leadId },
    include: { assignee: { select: userSelect } },
    orderBy: [
      { completedAt: { sort: "asc", nulls: "first" } },
      { createdAt: "desc" },
    ],
  });
}
export async function getTasksForCustomer(customerId: string) {
  await requireRole(...roles);
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, archivedAt: null },
    select: { id: true },
  });
  if (!customer) return [];
  return prisma.staffTask.findMany({
    where: { customerId },
    include: { assignee: { select: userSelect } },
    orderBy: [
      { completedAt: { sort: "asc", nulls: "first" } },
      { createdAt: "desc" },
    ],
  });
}
