import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { balancedPlan, reversePlan, type PostingLine } from "./posting-rules";
import { writeJournal } from "./post";
import { assertBooksWriter, type BooksWriter } from "./actor";
import { BooksInputError } from "./management";

// ACCT-1: adjusting journal entries. The books post every other entry from a source document; an adjustment
// is the one hand-written entry — the accountant's main tool, and the owner's. It goes through the same
// writeJournal machinery (balanced, mapped, closed-month safe) and is audited like every books change.
// Drift note: ACCOUNTANT-ACCESS.md calls this "the existing manual journal path"; the journal machinery
// existed, a hand-written entry point did not, so this module is that path.

export type AdjustmentLineInput = { accountId: string; debitCents: number; creditCents: number };

function personId(writer: BooksWriter): string {
  if (writer.kind !== "person") throw new BooksInputError("Only a signed-in person can write an adjusting entry.");
  return writer.userId;
}

function roleForAccount(account: { id: string; systemRole: string | null }): string {
  return account.systemRole ?? `ID:${account.id}`;
}

/** A balanced, hand-written journal entry. Returns the created entry's id and number. */
export async function createAdjustingEntry(
  writer: BooksWriter,
  input: { dateKey: string; memo: string; lines: AdjustmentLineInput[] },
): Promise<{ entryId: string; entryNumber: number }> {
  const userId = personId(writer);
  const date = businessDateFromKey(input.dateKey);
  if (!date || businessDateKey(date) !== input.dateKey) throw new BooksInputError("Choose an actual Colorado calendar date.");
  const memo = input.memo.trim();
  if (!memo || memo.length > 300) throw new BooksInputError("Write a short note saying what this adjustment is for (300 characters or fewer).");
  if (!Array.isArray(input.lines) || input.lines.length < 2 || input.lines.length > 12) {
    throw new BooksInputError("An adjusting entry needs at least two lines (and at most twelve).");
  }
  for (const line of input.lines) {
    if (!line || typeof line.accountId !== "string" || !line.accountId) throw new BooksInputError("Every line needs an account.");
    if (!Number.isSafeInteger(line.debitCents) || !Number.isSafeInteger(line.creditCents) || line.debitCents < 0 || line.creditCents < 0) {
      throw new BooksInputError("Line amounts must be whole cents, zero or more.");
    }
    if (line.debitCents > 0 && line.creditCents > 0) throw new BooksInputError("A line is either a debit or a credit, not both.");
    if (line.debitCents === 0 && line.creditCents === 0) throw new BooksInputError("Every line needs an amount.");
  }
  return prisma.$transaction(async (tx) => {
    await assertBooksWriter(tx, writer, ["OWNER", "ADMIN", "ACCOUNTANT"]);
    // An entry dated before the Books opening date would sit in the journal and the balance
    // sheet but outside every profit period and export range — refuse it up front.
    const settings = await tx.businessSettings.findUnique({
      where: { id: "singleton" }, select: { booksStartDate: true },
    });
    if (settings?.booksStartDate && date.getTime() < settings.booksStartDate.getTime()) {
      throw new BooksInputError("That date is before your books opening date, so the entry would fall outside your reports and exports. Use the opening date or later.");
    }
    const accounts = await tx.ledgerAccount.findMany({
      where: { id: { in: input.lines.map((l) => l.accountId) } },
      select: { id: true, systemRole: true, active: true, name: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const roleLines: PostingLine[] = [];
    for (const line of input.lines) {
      const account = byId.get(line.accountId);
      if (!account) throw new BooksInputError("One of the accounts no longer exists.");
      if (!account.active) throw new BooksInputError(`The account "${account.name}" is not active.`);
      roleLines.push({ role: roleForAccount(account), debitCents: line.debitCents, creditCents: line.creditCents });
    }
    const plan = balancedPlan(date, memo, roleLines);
    if (!plan) throw new BooksInputError("The entry does not balance — total debits must equal total credits.");
    const sourceId = `adj-${randomUUID()}`;
    const written = await writeJournal(tx, "ADJUSTMENT", sourceId, "MANUAL_ADJUSTMENT", plan);
    if (!written) throw new BooksInputError("That adjustment was already posted.");
    const entry = await tx.journalEntry.findUniqueOrThrow({
      where: { sourceType_sourceId_eventKind: { sourceType: "ADJUSTMENT", sourceId, eventKind: "MANUAL_ADJUSTMENT" } },
      select: { id: true, entryNumber: true },
    });
    const totalCents = input.lines.reduce((sum, l) => sum + l.debitCents, 0);
    await tx.auditLog.create({
      data: {
        userId, action: "books.adjustment.create", entityType: "JournalEntry", entityId: entry.id,
        newValue: { date: input.dateKey, memo, totalCents, lines: input.lines },
      },
    });
    return { entryId: entry.id, entryNumber: entry.entryNumber };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * The owner's undo for an adjusting entry: a reversing entry dated today (the machinery places it in the
 * current open month), never an edit of the original. Only the owner reverses (spec section 4).
 */
export async function reverseAdjustingEntry(writer: BooksWriter, entryId: string): Promise<{ reversalId: string }> {
  const userId = personId(writer);
  return prisma.$transaction(async (tx) => {
    await assertBooksWriter(tx, writer, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "JournalEntry" WHERE "id" = ${entryId} FOR UPDATE`;
    const entry = await tx.journalEntry.findUnique({
      where: { id: entryId },
      include: { lines: { include: { ledgerAccount: { select: { id: true, systemRole: true, name: true } } } } },
    });
    if (!entry || entry.sourceType !== "ADJUSTMENT" || entry.eventKind !== "MANUAL_ADJUSTMENT") {
      throw new BooksInputError("That entry is not an adjusting entry.");
    }
    const existing = await tx.journalEntry.findUnique({
      where: { sourceType_sourceId_eventKind: { sourceType: "ADJUSTMENT", sourceId: entry.sourceId, eventKind: "MANUAL_ADJUSTMENT_REVERSED" } },
      select: { id: true },
    });
    if (existing) throw new BooksInputError("That adjustment has already been reversed.");
    const original = {
      entryDate: entry.entryDate,
      memo: entry.memo,
      lines: entry.lines.map((l) => ({ role: roleForAccount(l.ledgerAccount), debitCents: l.debitCents, creditCents: l.creditCents })),
    };
    const today = businessDateFromKey(businessDateKey(new Date()))!;
    const plan = reversePlan(original, today, `Reversal of entry ${entry.entryNumber}: ${entry.memo}`.slice(0, 500));
    const written = await writeJournal(tx, "ADJUSTMENT", entry.sourceId, "MANUAL_ADJUSTMENT_REVERSED", plan);
    if (!written) throw new BooksInputError("That adjustment has already been reversed.");
    const reversal = await tx.journalEntry.findUniqueOrThrow({
      where: { sourceType_sourceId_eventKind: { sourceType: "ADJUSTMENT", sourceId: entry.sourceId, eventKind: "MANUAL_ADJUSTMENT_REVERSED" } },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId, action: "books.adjustment.reverse", entityType: "JournalEntry", entityId: entry.id,
        newValue: { reversalId: reversal.id },
      },
    });
    return { reversalId: reversal.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export type MonthAdjustment = {
  id: string;
  entryNumber: number;
  entryDate: Date;
  memo: string;
  sourceId: string;
  eventKind: string;
  lines: Array<{ accountName: string; debitCents: number; creditCents: number }>;
};

/** This month's adjusting entries, for the month view (owner, admin, accountant). */
export async function listMonthAdjustments(actorId: string, month: string): Promise<MonthAdjustment[]> {
  return prisma.$transaction(async (tx) => {
    await assertBooksWriter(tx, { kind: "person", userId: actorId }, ["OWNER", "ADMIN", "ACCOUNTANT"]);
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const entries = await tx.journalEntry.findMany({
      where: { sourceType: "ADJUSTMENT", entryDate: { gte: start, lt: end } },
      orderBy: [{ entryDate: "asc" }, { entryNumber: "asc" }],
      select: {
        id: true, entryNumber: true, entryDate: true, memo: true, sourceId: true, eventKind: true,
        lines: { select: { debitCents: true, creditCents: true, ledgerAccount: { select: { name: true } } } },
      },
    });
    return entries.map((e) => ({
      id: e.id, entryNumber: e.entryNumber, entryDate: e.entryDate, memo: e.memo, sourceId: e.sourceId, eventKind: e.eventKind,
      lines: e.lines.map((l) => ({ accountName: l.ledgerAccount.name, debitCents: l.debitCents, creditCents: l.creditCents })),
    }));
  });
}

/** The active accounts the adjusting-entry form offers (owner, admin, accountant). */
export async function listAdjustmentAccounts(actorId: string): Promise<Array<{ id: string; name: string }>> {
  return prisma.$transaction(async (tx) => {
    await assertBooksWriter(tx, { kind: "person", userId: actorId }, ["OWNER", "ADMIN", "ACCOUNTANT"]);
    return tx.ledgerAccount.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    });
  });
}

/** Which adjusting entries (by sourceId) already have a reversal — the month view marks them. */
export async function reversedAdjustmentSourceIds(actorId: string): Promise<Set<string>> {
  return prisma.$transaction(async (tx) => {
    await assertBooksWriter(tx, { kind: "person", userId: actorId }, ["OWNER", "ADMIN", "ACCOUNTANT"]);
    const rows = await tx.journalEntry.findMany({
      where: { sourceType: "ADJUSTMENT", eventKind: "MANUAL_ADJUSTMENT_REVERSED" },
      select: { sourceId: true },
    });
    return new Set(rows.map((r) => r.sourceId));
  });
}
