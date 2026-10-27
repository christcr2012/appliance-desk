import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import type { ExceptionItem } from "@/domains/exceptions/rules";
import { encryptField, hasFieldCryptoKey } from "@/lib/field-crypto";
import { PAPERWORK_TEMPLATES } from "./templates";
import {
  effectiveRecordDate,
  nextDueAfterRenewal,
  reminderState,
  type PaperworkStatusValue,
} from "./rules";
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
        kind: t.kind ?? "TASK",
        numberLabel: t.numberLabel ?? null,
        linkedObligationKeys: t.linkedObligationKeys ?? [],
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
  const issuedOn = input.issuedOn ? businessDateFromKey(input.issuedOn) : null;
  const expiresOn = input.expiresOn ? businessDateFromKey(input.expiresOn) : null;
  if (input.startedOn && !startedOn) throw new Error("That start date isn't a real date.");
  if (input.dueOn && !dueOn) throw new Error("That due date isn't a real date.");
  if (input.issuedOn && !issuedOn) throw new Error("That issued date isn't a real date.");
  if (input.expiresOn && !expiresOn) throw new Error("That expiry date isn't a real date.");
  const costCents =
    input.costDollars == null
      ? null
      : Math.round(Number(input.costDollars) * 100);
  // The number itself: encrypted here, never stored or logged in plain text, and
  // only its last four characters are kept for masked display (a number shorter
  // than five characters keeps no last-4, so it can never be shown in full).
  let numberUpdate: { numberEncrypted: string; numberLast4: string | null } | null = null;
  if (input.numberValue) {
    if (!hasFieldCryptoKey()) {
      throw new Error(
        "The encryption key isn't set yet, so this number can't be stored safely. Add the key first (it's on your checklist), then try again.",
      );
    }
    const value = input.numberValue.trim();
    numberUpdate = {
      numberEncrypted: encryptField(value),
      numberLast4: value.length >= 5 ? value.slice(-4) : null,
    };
  }
  return {
    data: {
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
      kind: input.kind,
      issuedOn,
      expiresOn,
      numberLabel: input.numberLabel ?? null,
      portalUrl: input.portalUrl ?? null,
      costCents,
      linkedObligationKeys: input.linkedObligationKeys,
    },
    numberUpdate,
  };
}

export async function createPaperwork(userId: string, input: PaperworkInput): Promise<string> {
  const { data, numberUpdate } = toData(input);
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const last = await tx.businessPaperwork.aggregate({ _max: { sortOrder: true } });
    const row = await tx.businessPaperwork.create({
      data: {
        ...data,
        ...(numberUpdate ?? {}),
        sortOrder: (last._max.sortOrder ?? 0) + 10,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
      select: { id: true },
    });
    await audit(tx, userId, "paperwork.created", row.id, numberUpdate ? ["number"] : undefined);
    return row.id;
  });
}

export async function updatePaperwork(
  userId: string,
  id: string,
  input: PaperworkInput,
  expectedVersion: number,
): Promise<void> {
  const { data, numberUpdate } = toData(input);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const rows = await tx.$queryRaw<{ version: number }[]>`
      SELECT "version" FROM "BusinessPaperwork" WHERE "id" = ${id} FOR UPDATE`;
    if (!rows[0]) throw new Error("That item no longer exists.");
    if (rows[0].version !== expectedVersion) {
      throw new Error(PAPERWORK_STALE_MESSAGE);
    }
    const finishing = input.status === "DONE";
    await tx.businessPaperwork.update({
      where: { id },
      data: {
        ...data,
        ...(numberUpdate ?? {}),
        ...(finishing ? { lastDoneOn: new Date() } : {}),
        updatedByUserId: userId,
        version: { increment: 1 },
      },
    });
    await audit(tx, userId, "paperwork.updated", id, [
      ...Object.keys(data),
      ...(numberUpdate ? ["number"] : []),
    ]);
  });
}

/** "I renewed / filed it": moves a repeating item to its next date, or marks a one-time item done. */
export const PAPERWORK_STALE_MESSAGE = "This item was changed somewhere else. Reload the page and try again.";

/** `expectedVersion` is the version the owner was looking at, so a double-click or a second tab cannot skip a renewal year. */
export async function markPaperworkDone(userId: string, id: string, expectedVersion: number, now = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const rows = await tx.$queryRaw<
      { dueOn: Date | null; repeatEveryMonths: number | null; version: number }[]
    >`SELECT "dueOn", "repeatEveryMonths", "version" FROM "BusinessPaperwork" WHERE "id" = ${id} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new Error("That item no longer exists.");
    if (row.version !== expectedVersion) throw new Error(PAPERWORK_STALE_MESSAGE);
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
    // VAULT-1: file rows point at the record (deleting is restricted while they
    // exist), so refuse in plain words instead of failing on the constraint.
    const fileCount = await tx.businessRecordFile.count({ where: { recordId: id } });
    if (fileCount > 0) {
      throw new Error("This record has files attached. Archive it instead, or remove its files first.");
    }
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
    // VAULT-1: a record's own expiry counts too — the reminder keys off the earlier date.
    const effective = effectiveRecordDate(row);
    const state = reminderState(
      { status: row.status as PaperworkStatusValue, dueOn: effective, remindDaysBefore: row.remindDaysBefore },
      now,
    );
    if (state.kind === "none" || state.kind === "upcoming" || !effective) continue;
    const overdue = state.kind === "overdue";
    const isExpiry = row.expiresOn != null && effective.getTime() === row.expiresOn.getTime() && row.dueOn?.getTime() !== row.expiresOn.getTime();
    items.push({
      category: "BUSINESS_PAPERWORK",
      severity: overdue || state.daysLeft <= 7 ? "high" : "medium",
      title: `${row.title} — ${overdue ? "overdue" : "coming up"}`,
      detail:
        `${isExpiry ? "Expires" : "Due"} ${businessDateKey(effective)}.` +
        (row.agency ? ` Agency: ${row.agency}.` : "") +
        " Open it to renew or update it, then press 'Mark done'.",
      href: `/desk/paperwork/${row.id}`,
      dueOn: effective,
      dueDateOnly: true,
      since: effective,
    });
  }
  const setupLeft = rows.filter(
    (row) =>
      !row.dueOn &&
      !row.expiresOn &&
      (row.status === "TO_DO" || row.status === "IN_PROGRESS") &&
      row.templateKey !== null,
  );
  if (setupLeft.length > 0) {
    items.push({
      category: "BUSINESS_PAPERWORK",
      severity: "medium",
      title: `Business setup: ${setupLeft.length} ${setupLeft.length === 1 ? "step" : "steps"} still to do`,
      detail: "Your LLC, EIN, licenses and insurance. Open Business records to see what's next, or mark steps you don't need.",
      href: "/desk/paperwork",
      since: setupLeft.reduce((oldest, row) => (row.createdAt < oldest ? row.createdAt : oldest), setupLeft[0].createdAt),
    });
  }
  return items;
}
