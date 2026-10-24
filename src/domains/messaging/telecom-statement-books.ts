import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { checkExpenseFields, createExpenseInTx, postExpense } from "@/domains/books/expenses";

/** COM-N3: a verified phone-company statement becomes ONE books Expense (new, or matched to one already entered by hand). */
export class StatementBooksError extends Error {}

export type BookStatementInput = {
  statementId: string;
  /** The day the owner actually paid it (YYYY-MM-DD, Colorado day). */
  paidOn: string;
  paidFromAccountId: string;
  categoryId: string;
  /** Match a bill that was already entered by hand instead of making a second one. */
  linkExpenseId?: string;
};
export type BookStatementResult = { expenseId: string; posted: boolean; linkedExisting: boolean };

const marker = (statementId: string) => `[telecom-statement ${statementId}]`;

/**
 * Owner only. Nothing is booked until the owner has verified the statement AND says when and from where it was paid.
 * One statement links to one Expense (database-unique). A manually entered bill is matched by explicit choice, never duplicated.
 * Top-ups and account balance are never booked here. Posting uses the normal expense path, so closed-month rules apply.
 */
export async function bookTelecomStatementExpense(actorUserId: string, input: BookStatementInput): Promise<BookStatementResult> {
  await prisma.$transaction((tx) => assertActiveTeamActor(tx, actorUserId, ["OWNER"]));
  const paidDate = businessDateFromKey(input.paidOn);
  if (!paidDate || businessDateKey(paidDate) !== input.paidOn) throw new StatementBooksError("Enter the day it was paid.");

  const statement = await prisma.telecomStatement.findUnique({ where: { id: input.statementId } });
  if (!statement) throw new StatementBooksError("Couldn't find that statement.");
  if (statement.state !== "VERIFIED") throw new StatementBooksError("Verify the statement against its saved PDF first.");
  if (statement.currency !== "USD") throw new StatementBooksError("Only US-dollar statements can be booked.");
  if (statement.invoiceTotalCents <= 0) throw new StatementBooksError("A credit or zero statement is not booked as an expense. Enter the credit in Books by hand.");

  // Already linked: finish the job (post it if it is still a draft) and never make another.
  if (statement.expenseId) return finishLinked(actorUserId, statement.expenseId, false);

  if (input.linkExpenseId) {
    return prisma.$transaction(async (tx) => {
      await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
      await tx.$queryRaw`SELECT "id" FROM "TelecomStatement" WHERE "id" = ${statement.id} FOR UPDATE`;
      const fresh = await tx.telecomStatement.findUniqueOrThrow({ where: { id: statement.id }, select: { expenseId: true } });
      if (fresh.expenseId) throw new StatementBooksError("This statement is already booked.");
      await tx.$queryRaw`SELECT "id" FROM "Expense" WHERE "id" = ${input.linkExpenseId} FOR UPDATE`;
      const expense = await tx.expense.findUnique({ where: { id: input.linkExpenseId! }, select: { id: true, status: true, amountCents: true } });
      if (!expense || expense.status === "VOID") throw new StatementBooksError("That expense can't be matched (missing or voided).");
      if (expense.amountCents !== statement.invoiceTotalCents) throw new StatementBooksError("That expense is for a different amount than the statement.");
      const taken = await tx.telecomStatement.findFirst({ where: { expenseId: expense.id }, select: { id: true } });
      if (taken) throw new StatementBooksError("That expense is already matched to another statement.");
      await tx.telecomStatement.update({ where: { id: statement.id }, data: { expenseId: expense.id, paidFromAccountId: input.paidFromAccountId, paidOn: paidDate } });
      await tx.auditLog.create({ data: { userId: actorUserId, action: "TELECOM_STATEMENT_MATCHED_EXPENSE", entityType: "TelecomStatement", entityId: statement.id, newValue: { expenseId: expense.id } } });
      return { expenseId: expense.id, posted: expense.status === "POSTED", linkedExisting: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // One transaction under the statement's lock: reuse a draft an earlier try left behind, or make it, and link it.
  const fields = checkExpenseFields({
    date: input.paidOn, amountCents: statement.invoiceTotalCents, vendorTaxCents: statement.vendorTaxCents ?? 0,
    vendorName: "Twilio", categoryId: input.categoryId, paidFromAccountId: input.paidFromAccountId,
    memo: `Phone-company statement ${statement.externalId} (${businessDateKey(statement.periodStart)} to ${businessDateKey(statement.periodEnd)}) ${marker(statement.id)}`,
  });
  const expenseId = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "TelecomStatement" WHERE "id" = ${statement.id} FOR UPDATE`;
    const fresh = await tx.telecomStatement.findUniqueOrThrow({ where: { id: statement.id }, select: { expenseId: true } });
    if (fresh.expenseId) return fresh.expenseId;
    const left = await tx.expense.findFirst({ where: { memo: { contains: marker(statement.id) }, status: { not: "VOID" } }, select: { id: true } });
    const id = left?.id ?? await createExpenseInTx(tx, actorUserId, fields, "DRAFT");
    await tx.telecomStatement.update({ where: { id: statement.id }, data: { expenseId: id, paidFromAccountId: input.paidFromAccountId, paidOn: paidDate } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "TELECOM_STATEMENT_BOOKED_EXPENSE", entityType: "TelecomStatement", entityId: statement.id, newValue: { expenseId: id, amountCents: statement.invoiceTotalCents } } });
    return id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return finishLinked(actorUserId, expenseId, false);
}

async function finishLinked(actorUserId: string, expenseId: string, linkedExisting: boolean): Promise<BookStatementResult> {
  const expense = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId }, select: { status: true, version: true } });
  if (expense.status === "VOID") throw new StatementBooksError("The expense linked to this statement was voided. Ask for it to be relinked.");
  if (expense.status === "POSTED") return { expenseId, posted: true, linkedExisting };
  await postExpense(actorUserId, expenseId, expense.version);
  return { expenseId, posted: true, linkedExisting };
}
