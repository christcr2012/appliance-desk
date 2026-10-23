import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import type { ExceptionItem } from "@/domains/exceptions/rules";
import { PAPERWORK_TEMPLATES } from "./templates";
import { nextDueAfterRenewal, reminderState, type PaperworkStatusValue } from "./rules";
import type { PaperworkInput } from "./schema";

/** Owner-only everywhere: the numbers (EIN, license numbers) never reach staff. */
function requireOwnerRole(role: string | undefined) {
  if (role !== "OWNER") throw new Error("Only the owner can see or change business paperwork.");
}

export async function listPaperwork(role: string | undefined) {
  requireOwnerRole(role);
  return prisma.businessPaperwork.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
}

export async function getPaperwork(role: string | undefined, id: string) {
  requireOwnerRole(role);
  return prisma.businessPaperwork.findUnique({ where: { id } });
}

async function audit(tx: Prisma.TransactionClient, userId: string, action: string, id: string, fields?: string[]) {
  // Never write the reference number (EIN, license numbers) or notes into the activity log.
  await tx.auditLog.create({
    data: {
      userId,
      action,
      entityType: "BusinessPaperwork",
      entityId: id,
      ...(fields ? { newValue: { fields } } : {}),
    },
  });
}

/** Adds the starter checklist. Running it again never duplicates or overwrites anything. */
export async function addStarterChecklist(userId: string): Promise<{ added: number }> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const result = await tx.businessPaperwork.createMany({
      data: PAPERWORK_TEMPLATES.map((t, index) => ({
        templateKey: t.key,
        title: t.title,
        groupName: t.group,
        whatItIs: t.whatItIs,
        agency: t.agency ?? null,
        officialUrl: t.officialUrl ?? null,
        remindDaysBefore: t.remindDaysBefore ?? 30,
        repeatEveryMonths: t.repeatEveryMonths ?? null,
        sortOrder: index * 10,
        createdByUserId: userId,
      })),
      skipDuplicates: true,
    });
    await audit(tx, userId, "paperwork.starter_added", "starter");
    return { added: result.count };
  });
}

function toData(input: PaperworkInput) {
  const startedOn = input.startedOn ? businessDateFromKey(input.startedOn) : null;
  const dueOn = input.dueOn ? businessDateFromKey(input.dueOn) : null;
  if (input.startedOn && !startedOn) throw new Error("That start date isn't a real date.");
  if (input.dueOn && !dueOn) throw new Error("That due date isn't a real date.");
  return {
    title: input.title,
    groupName: input.groupName,
    status: input.status,
    whatItIs: input.whatItIs ?? null,
    agency: input.agency ?? null,
    officialUrl: input.officialUrl ?? null,
    referenceNumber: input.referenceNumber ?? null,
    startedOn,
    dueOn,
    remindDaysBefore: input.remindDaysBefore,
    repeatEveryMonths: input.repeatEveryMonths ?? null,
    notes: input.notes ?? null,
  };
}

export async function createPaperwork(userId: string, input: PaperworkInput): Promise<string> {
  const data = toData(input);
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const last = await tx.businessPaperwork.aggregate({ _max: { sortOrder: true } });
    const row = await tx.businessPaperwork.create({
      data: { ...data, sortOrder: (last._max.sortOrder ?? 0) + 10, createdByUserId: userId, updatedByUserId: userId },
      select: { id: true },
    });
    await audit(tx, userId, "paperwork.created", row.id);
    return row.id;
  });
}

export async function updatePaperwork(
  userId: string,
  id: string,
  input: PaperworkInput,
  expectedVersion: number,
): Promise<void> {
  const data = toData(input);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const rows = await tx.$queryRaw<{ version: number }[]>`
      SELECT "version" FROM "BusinessPaperwork" WHERE "id" = ${id} FOR UPDATE`;
    if (!rows[0]) throw new Error("That item no longer exists.");
    if (rows[0].version !== expectedVersion) {
      throw new Error("This item was changed somewhere else. Reload the page and try again.");
    }
    const finishing = input.status === "DONE";
    await tx.businessPaperwork.update({
      where: { id },
      data: {
        ...data,
        ...(finishing ? { lastDoneOn: new Date() } : {}),
        updatedByUserId: userId,
        version: { increment: 1 },
      },
    });
    await audit(tx, userId, "paperwork.updated", id, Object.keys(data));
  });
}

/** "I renewed / filed it": moves a repeating item to its next date, or marks a one-time item done. */
export async function markPaperworkDone(userId: string, id: string, now = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const rows = await tx.$queryRaw<
      { dueOn: Date | null; repeatEveryMonths: number | null }[]
    >`SELECT "dueOn", "repeatEveryMonths" FROM "BusinessPaperwork" WHERE "id" = ${id} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new Error("That item no longer exists.");
    // A repeating item moves to its next date. A one-time item is simply finished, so its date is cleared
    // and it stops reminding. (For a license that expires, change the date on the item instead.)
    const nextDue =
      row.repeatEveryMonths && row.dueOn
        ? nextDueAfterRenewal(row.dueOn, row.repeatEveryMonths, now)
        : null;
    await tx.businessPaperwork.update({
      where: { id },
      data: {
        status: "DONE",
        lastDoneOn: now,
        dueOn: nextDue,
        updatedByUserId: userId,
        version: { increment: 1 },
      },
    });
    await audit(tx, userId, "paperwork.marked_done", id);
  });
}

export async function deletePaperwork(userId: string, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const row = await tx.businessPaperwork.findUnique({ where: { id }, select: { templateKey: true } });
    if (!row) return;
    if (row.templateKey) throw new Error("Starter items can't be deleted. Mark it 'Not needed' instead.");
    await tx.businessPaperwork.delete({ where: { id } });
    await audit(tx, userId, "paperwork.deleted", id);
  });
}

/** What goes on the Today list: dated items inside their reminder window, plus one setup summary. */
export async function listPaperworkAttention(now = new Date()): Promise<ExceptionItem[]> {
  const rows = await prisma.businessPaperwork.findMany({
    where: { status: { not: "NOT_NEEDED" } },
    orderBy: [{ dueOn: "asc" }, { sortOrder: "asc" }],
    take: 500,
  });
  const items: ExceptionItem[] = [];
  for (const row of rows) {
    const state = reminderState(
      { status: row.status as PaperworkStatusValue, dueOn: row.dueOn, remindDaysBefore: row.remindDaysBefore },
      now,
    );
    if (state.kind === "none" || state.kind === "upcoming" || !row.dueOn) continue;
    const overdue = state.kind === "overdue";
    items.push({
      category: "BUSINESS_PAPERWORK",
      severity: overdue || state.daysLeft <= 7 ? "high" : "medium",
      title: `${row.title} — ${overdue ? "overdue" : "coming up"}`,
      detail:
        `Due ${businessDateKey(row.dueOn)}.` +
        (row.agency ? ` Agency: ${row.agency}.` : "") +
        " Open it to renew or update it, then press 'Mark done'.",
      href: `/desk/paperwork/${row.id}`,
      dueOn: row.dueOn,
      dueDateOnly: true,
      since: row.dueOn,
    });
  }
  const setupLeft = rows.filter(
    (row) => !row.dueOn && (row.status === "TO_DO" || row.status === "IN_PROGRESS") && row.templateKey !== null,
  );
  if (setupLeft.length > 0) {
    items.push({
      category: "BUSINESS_PAPERWORK",
      severity: "medium",
      title: `Business setup: ${setupLeft.length} ${setupLeft.length === 1 ? "step" : "steps"} still to do`,
      detail: "Your LLC, EIN, licenses and insurance. Open Business paperwork to see what's next, or mark steps you don't need.",
      href: "/desk/paperwork",
      since: setupLeft.reduce((oldest, row) => (row.createdAt < oldest ? row.createdAt : oldest), setupLeft[0].createdAt),
    });
  }
  return items;
}
