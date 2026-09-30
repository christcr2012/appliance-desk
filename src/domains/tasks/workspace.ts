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
const select = {
  id: true,
  note: true,
  dueDate: true,
  lead: { select: { id: true, contactName: true } },
  customer: {
    select: { id: true, user: { select: { name: true, email: true } } },
  },
  job: { select: { id: true, type: true } },
} satisfies Prisma.StaffTaskSelect;
const orderBy = [
  { dueDate: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
] satisfies Prisma.StaffTaskOrderByWithRelationInput[];

export async function getTaskWorkspace(
  filter: TaskDueFilter,
  requestedPage: number,
  now = new Date(),
) {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const where = taskFilterWhere(filter, now);
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
  await requireRole("OWNER", "ADMIN", "STAFF");
  const where = { completedAt: null, dueDate: { lt: taskDates(now).tomorrow } };
  const [tasks, totalCount, overdueCount] = await Promise.all([
    prisma.staffTask.findMany({ where, select, orderBy, take: 6 }),
    prisma.staffTask.count({ where }),
    prisma.staffTask.count({ where: taskFilterWhere("overdue", now) }),
  ]);
  return { tasks, totalCount, overdueCount };
}
