import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { businessDateKey, type TaskDueFilter } from "@/lib/business-date";

export const TASK_PAGE_SIZE = 25;
export const TASK_FILTERS: { value: TaskDueFilter; label: string }[] = [
  { value: "all", label: "All open" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "undated", label: "No due date" },
];
export function parseTaskFilter(value?: string): TaskDueFilter {
  return TASK_FILTERS.find((f) => f.value === value)?.value ?? "all";
}

function taskDates(now: Date) {
  const today = new Date(`${businessDateKey(now)}T00:00:00Z`);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return { today, tomorrow };
}
export function taskFilterWhere(
  filter: TaskDueFilter,
  now: Date,
): Prisma.StaffTaskWhereInput {
  const { today, tomorrow } = taskDates(now);
  const dates: Record<TaskDueFilter, Prisma.StaffTaskWhereInput> = {
    all: {},
    overdue: { dueDate: { lt: today } },
    today: { dueDate: { gte: today, lt: tomorrow } },
    upcoming: { dueDate: { gte: tomorrow } },
    undated: { dueDate: null },
  };
  return { completedAt: null, ...dates[filter] };
}
export const TASK_VIEWS = [
  { value: "team", label: "Team" },
  { value: "mine", label: "Mine" },
  { value: "unassigned", label: "Unassigned" },
  { value: "completed", label: "Completed" },
] as const;
export type TaskView = (typeof TASK_VIEWS)[number]["value"];
export function parseTaskView(value?: string): TaskView {
  return TASK_VIEWS.find((v) => v.value === value)?.value ?? "team";
}
function selection(role: string) {
  return {
    id: true,
    note: true,
    dueDate: true,
    priority: true,
    version: true,
    completedAt: true,
    assignee: {
      select: { id: true, name: true, email: true, archivedAt: true },
    },
    lead:
      role !== "STAFF" ? { select: { id: true, contactName: true } } : false,
    customer: {
      where: { archivedAt: null },
      select: { id: true, user: { select: { name: true, email: true } } },
    },
    job: {
      where: { OR: [{ customerId: null }, { customer: { archivedAt: null } }] },
      select: { id: true, type: true },
    },
  } satisfies Prisma.StaffTaskSelect;
}
const orderBy = [
  { priority: "desc" },
  { dueDate: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
] satisfies Prisma.StaffTaskOrderByWithRelationInput[];

export async function getTaskWorkspace(
  filter: TaskDueFilter,
  requestedPage: number,
  now = new Date(),
  view: TaskView = "team",
) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const select = selection(session.user.role);
  const where: Prisma.StaffTaskWhereInput = {
    ...taskFilterWhere(filter, now),
    ...(view === "mine"
      ? { assigneeUserId: session.user.id }
      : view === "unassigned"
        ? { assigneeUserId: null }
        : view === "completed"
          ? { completedAt: { not: null } }
          : {}),
  };
  const totalCount = await prisma.staffTask.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalCount / TASK_PAGE_SIZE));
  const page = Math.min(
    totalPages,
    Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1),
  );
  const tasks = await prisma.staffTask.findMany({
    where,
    select,
    orderBy,
    take: TASK_PAGE_SIZE,
    skip: (page - 1) * TASK_PAGE_SIZE,
  });
  return { tasks, page, totalCount, totalPages };
}

export async function getDueTaskSummary(now = new Date()) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const select = selection(session.user.role);
  const where = { completedAt: null, dueDate: { lt: taskDates(now).tomorrow } };
  const [tasks, totalCount, overdueCount] = await Promise.all([
    prisma.staffTask.findMany({ where, select, orderBy, take: 6 }),
    prisma.staffTask.count({ where }),
    prisma.staffTask.count({ where: taskFilterWhere("overdue", now) }),
  ]);
  return { tasks, totalCount, overdueCount };
}
