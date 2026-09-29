import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// A staff member's own follow-up reminders (2026-09-29, Chris's CRM
// brainstorm — see docs/DECISIONS.md). Deliberately separate from the
// automatic exception flags src/domains/growth/src/domains/exceptions
// already generate (churn risk, overdue billing, maintenance due) —
// those are system-detected from billing/job/agreement state; this is
// something a person chose to jot down for themself ("call the Oak
// Street property manager back Thursday about renewing"), which the
// system has no way to infer on its own. Optionally linked to whatever
// it's about (a lead, customer, or job) purely as a convenient
// reference — StaffTask's own foreign keys are all onDelete: SetNull, so
// deleting the linked record never deletes the task, it just becomes
// unlinked.
// ---------------------------------------------------------------------------

export type NewStaffTaskInput = {
  note: string;
  dueDate?: Date | null;
  leadId?: string | null;
  customerId?: string | null;
  jobId?: string | null;
};

export async function createTask(userId: string, input: NewStaffTaskInput) {
  const note = input.note.trim();
  if (!note) {
    throw new Error("A task needs a note.");
  }
  return prisma.staffTask.create({
    data: {
      note,
      dueDate: input.dueDate ?? null,
      leadId: input.leadId || null,
      customerId: input.customerId || null,
      jobId: input.jobId || null,
      createdByUserId: userId,
    },
  });
}

/** Every not-yet-completed task, soonest due date first (tasks with no
 * due date sort last — nothing to be late on, so they shouldn't crowd
 * out ones that are). */
export async function getOpenTasks() {
  const tasks = await prisma.staffTask.findMany({
    where: { completedAt: null },
    include: {
      createdBy: { select: { name: true, email: true } },
      lead: { select: { id: true, contactName: true } },
      customer: { select: { id: true, user: { select: { name: true, email: true } } } },
      job: { select: { id: true, type: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  });
  return [...tasks].sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime();
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });
}

export async function getTasksForLead(leadId: string) {
  return prisma.staffTask.findMany({
    where: { leadId },
    orderBy: [{ completedAt: "asc" }, { createdAt: "desc" }],
  });
}

export async function getTasksForCustomer(customerId: string) {
  return prisma.staffTask.findMany({
    where: { customerId },
    orderBy: [{ completedAt: "asc" }, { createdAt: "desc" }],
  });
}

export async function completeTask(id: string): Promise<void> {
  await prisma.staffTask.update({ where: { id }, data: { completedAt: new Date() } });
}

export async function reopenTask(id: string): Promise<void> {
  await prisma.staffTask.update({ where: { id }, data: { completedAt: null } });
}

export async function deleteTask(id: string): Promise<void> {
  await prisma.staffTask.delete({ where: { id } });
}
