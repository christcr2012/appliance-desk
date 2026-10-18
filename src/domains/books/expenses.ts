import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { getPrivatePhotoStore, privatePhotoPathFromUrl } from "@/lib/photo-storage";
import { postForSource } from "./post";
import { recordUseTaxForPurchase } from "@/domains/tax/use-tax";

export class ExpenseInputError extends Error {}
export type ExpenseFields = {
  date: string; amountCents: number; vendorTaxCents: number; vendorName: string;
  categoryId: string; paidFromAccountId: string; memo?: string;
  applianceId?: string; jobId?: string; purchaseOrderId?: string;
  capitalizeToAppliance?: boolean;
};
export const cents = (n: number, field: string) => {
  if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000_000)
    throw new ExpenseInputError(field + " must be a safe whole-cent amount.");
  return n;
};
const name = (s: string, field: string, max = 160) => {
  if (typeof s !== "string" || !s.trim() || s.trim().length > max)
    throw new ExpenseInputError("Enter a valid " + field + ".");
  return s.trim();
};
const optional = (s: string | undefined, max = 500) => {
  if (!s?.trim()) return null;
  if (s.length > max) throw new ExpenseInputError("Optional description is too long.");
  return s.trim();
};
function checked(input: ExpenseFields) {
  const date = businessDateFromKey(input.date);
  if (!date || businessDateKey(date) !== input.date || date.getTime() > Date.now())
    throw new ExpenseInputError("Choose an actual purchase date that is not in the future.");
  const amountCents = cents(input.amountCents, "Expense");
  if (amountCents === 0) throw new ExpenseInputError("Expense must be greater than zero.");
  const vendorTaxCents = cents(input.vendorTaxCents, "Seller's tax");
  if (vendorTaxCents > amountCents) throw new ExpenseInputError("Seller's tax exceeds the total paid.");
  if (input.capitalizeToAppliance && !input.applianceId)
    throw new ExpenseInputError("Choose the purchased rental appliance to capitalize.");
  return {
    spentOn: date, amountCents, vendorTaxCents,
    vendorName: name(input.vendorName, "vendor"), categoryId: name(input.categoryId, "category"),
    paidFromAccountId: name(input.paidFromAccountId, "payment account"),
    memo: optional(input.memo),
    applianceId: optional(input.applianceId, 100),
    jobId: optional(input.jobId, 100),
    purchaseOrderId: optional(input.purchaseOrderId, 100),
    capitalizeToAppliance: !!input.capitalizeToAppliance,
  };
}
async function validateReferences(tx: Prisma.TransactionClient, input: ReturnType<typeof checked>) {
  const [category, paid, appliance, job, purchase] = await Promise.all([
    tx.expenseCategory.findUnique({ where: { id: input.categoryId }, include: { } }),
    tx.ledgerAccount.findUnique({ where: { id: input.paidFromAccountId } }),
    input.applianceId ? tx.appliance.findUnique({ where: { id: input.applianceId } }) : Promise.resolve(null),
    input.jobId ? tx.job.findUnique({ where: { id: input.jobId }, select: { id: true } }) : Promise.resolve(null),
    input.purchaseOrderId ? tx.purchaseOrder.findUnique({ where: { id: input.purchaseOrderId }, select: { id: true } }) : Promise.resolve(null),
  ]);
  if (!category?.active) throw new ExpenseInputError("Expense category is unavailable.");
  const categoryAccount = await tx.ledgerAccount.findUnique({ where: { id: category.ledgerAccountId } });
  if (!categoryAccount?.active || categoryAccount.type !== "EXPENSE")
    throw new ExpenseInputError("Category expense account is unavailable.");
  if (!paid?.active || (!paid.isPaymentSource && paid.systemRole !== "OWNER_CONTRIBUTIONS"))
    throw new ExpenseInputError("Choose an active account used to pay an expense.");
  if (input.applianceId && (!appliance || appliance.archivedAt))
    throw new ExpenseInputError("Rental appliance cannot be found.");
  if (input.jobId && !job) throw new ExpenseInputError("Job cannot be found.");
  if (input.purchaseOrderId && !purchase) throw new ExpenseInputError("Purchase order cannot be found.");
  return { category, paid, appliance };
}
function audit(tx: Prisma.TransactionClient, userId: string, id: string, action: string, detail: Record<string, string | number | boolean | null>) {
  return tx.auditLog.create({ data: { userId, action, entityType: "Expense", entityId: id, newValue: detail } });
}

/** All money and permissions live in the same DB transaction; client role is never accepted. */
export async function createExpense(userId: string, fields: ExpenseFields, mode: "DRAFT" | "SUBMITTED" | "POSTED" = "SUBMITTED") {
  const input = checked(fields);
  const id = await prisma.$transaction(async tx => {
    const actor = await assertActiveTeamActor(tx, userId);
    if (mode !== "SUBMITTED" && actor.role === "STAFF")
      throw new ExpenseInputError("Staff may submit expenses only.");
    await validateReferences(tx, input);
    const expense = await tx.expense.create({ data: {
      ...input, status: mode === "POSTED" ? "DRAFT" : mode,
      submittedByUserId: userId,
    } });
    await audit(tx, userId, expense.id, "books.expense.create", { mode, amountCents: input.amountCents });
    return expense.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (mode === "POSTED") await postExpense(userId, id, 1);
  return { id };
}
export async function postExpense(userId: string, id: string, expectedVersion: number) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new ExpenseInputError("Invalid expense version.");
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "Expense" WHERE "id" = ${id} FOR UPDATE`;
    const expense = await tx.expense.findUnique({ where: { id } });
    if (!expense || expense.version !== expectedVersion || !["DRAFT", "SUBMITTED"].includes(expense.status))
      throw new ExpenseInputError("Expense changed or is already posted; refresh the list.");
    const books = await tx.businessSettings.findUnique({ where: { id: "singleton" }, select: { booksStartDate: true } });
    if (!books?.booksStartDate || expense.spentOn < books.booksStartDate)
      throw new ExpenseInputError("Initialize books through the owner before approving this expense's journal.");
    await validateReferences(tx, {
      spentOn: expense.spentOn, amountCents: expense.amountCents, vendorTaxCents: expense.vendorTaxCents,
      vendorName: expense.vendorName, categoryId: expense.categoryId, paidFromAccountId: expense.paidFromAccountId,
      memo: expense.memo, applianceId: expense.applianceId, jobId: expense.jobId,
      purchaseOrderId: expense.purchaseOrderId, capitalizeToAppliance: expense.capitalizeToAppliance,
    });
    if (expense.capitalizeToAppliance && expense.applianceId) {
      const unit = await tx.appliance.findUniqueOrThrow({ where: { id: expense.applianceId } });
      if (unit.acquisitionCostCents !== null && unit.acquisitionCostCents !== expense.amountCents)
        throw new ExpenseInputError("Rental appliance already has a different purchase cost; owner review required.");
      const already = await tx.expense.count({ where: {
        applianceId: unit.id, capitalizeToAppliance: true, status: "POSTED", id: { not: id },
      } });
      if (already) throw new ExpenseInputError("Another posted expense already capitalized this appliance.");
      if (unit.acquisitionCostCents === null)
        await tx.appliance.update({ where: { id: unit.id }, data: { acquisitionCostCents: expense.amountCents } });
    }
    await recordUseTaxForPurchase(tx, {
      sourceType: "EXPENSE", sourceId: id, purchasedOn: expense.spentOn,
      amountCents: expense.amountCents - expense.vendorTaxCents,
      vendorTaxCents: expense.vendorTaxCents, isRentalInventory: expense.capitalizeToAppliance,
    });
    await tx.expense.update({ where: { id }, data: {
      status: "POSTED", postedByUserId: userId, postedAt: new Date(), version: { increment: 1 },
    } });
    await postForSource(tx, "EXPENSE", id);
    await audit(tx, userId, id, "books.expense.post", { version: expectedVersion, amountCents: expense.amountCents });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 25_000 });
}
export async function voidExpense(userId: string, id: string, expectedVersion: number, reason: string) {
  const why = name(reason, "void reason", 300);
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "Expense" WHERE "id" = ${id} FOR UPDATE`;
    const row = await tx.expense.findUnique({ where: { id } });
    if (!row || row.version !== expectedVersion || row.status !== "POSTED")
      throw new ExpenseInputError("Only an unchanged, posted expense can be voided.");
    const original = await tx.journalEntry.findUnique({ where: { sourceType_sourceId_eventKind: {
      sourceType: "EXPENSE", sourceId: id, eventKind: "EXPENSE_POSTED",
    } }, select: { id: true } });
    if (!original) throw new ExpenseInputError("The original expense journal is missing; reversal requires review.");
    await tx.expense.update({ where: { id }, data: {
      status: "VOID", voidReason: why, voidedAt: new Date(), voidedByUserId: userId,
      version: { increment: 1 },
    } });
    await postForSource(tx, "EXPENSE", id);
    await recordUseTaxForPurchase(tx, {
      sourceType: "EXPENSE", sourceId: id, purchasedOn: row.spentOn,
      amountCents: 0, vendorTaxCents: 0, isRentalInventory: row.capitalizeToAppliance,
    });
    if (row.capitalizeToAppliance && row.applianceId) {
      const unit = await tx.appliance.findUniqueOrThrow({ where: { id: row.applianceId } });
      if (unit.acquisitionCostCents === row.amountCents)
        await tx.appliance.update({ where: { id: unit.id }, data: { acquisitionCostCents: null } });
    }
    await audit(tx, userId, id, "books.expense.void", { version: expectedVersion, reason: why });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 25_000 });
}
export async function attachExpenseReceipt(userId: string, expenseId: string, uploadedUrl: string) {
  const store = getPrivatePhotoStore();
  if (!store) throw new ExpenseInputError("Private receipt storage is not configured.");
  const pathname = privatePhotoPathFromUrl(uploadedUrl, store.storeId);
  if (!pathname || !pathname.startsWith("expenses/" + expenseId + "/"))
    throw new ExpenseInputError("Receipt is not from this expense's verified private store.");
  return prisma.$transaction(async tx => {
    const actor = await assertActiveTeamActor(tx, userId);
    await tx.$queryRaw`SELECT "id" FROM "Expense" WHERE "id" = ${expenseId} FOR UPDATE`;
    const expense = await tx.expense.findUnique({ where: { id: expenseId } });
    if (!expense || expense.status === "VOID" || (actor.role === "STAFF" && expense.submittedByUserId !== userId))
      throw new ExpenseInputError("Expense receipt is not accessible.");
    if (expense.receiptPhotoId) throw new ExpenseInputError("Receipt is already attached; request a reviewed correction.");
    const photo = await tx.photo.create({ data: {
      url: uploadedUrl, altText: "Private expense receipt",
    } });
    await tx.expense.update({ where: { id: expenseId }, data: { receiptPhotoId: photo.id, version: { increment: 1 } } });
    await audit(tx, userId, expenseId, "books.expense.receipt", { photoId: photo.id });
    return { photoId: photo.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function getExpenses(userId: string, status?: string) {
  const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, archivedAt: true } });
  if (!actor || actor.archivedAt || !["OWNER","ADMIN","STAFF"].includes(actor.role))
    throw new ExpenseInputError("This workspace is not available.");
  const manager = actor.role !== "STAFF";
  const filter = status && ["DRAFT","SUBMITTED","POSTED","VOID"].includes(status) ? status as "DRAFT"|"SUBMITTED"|"POSTED"|"VOID" : undefined;
  const [rows, categories, payments, templates] = await Promise.all([
    prisma.expense.findMany({
      where: { ...(manager ? {} : { submittedByUserId: userId }), ...(filter ? { status: filter } : {}) },
      orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }], take: 100,
      include: { category: { select: { name: true } } },
    }),
    prisma.expenseCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.ledgerAccount.findMany({ where: { active: true, OR: [
      { isPaymentSource: true }, { systemRole: "OWNER_CONTRIBUTIONS" },
    ] }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    manager ? prisma.recurringExpense.findMany({ orderBy: { name: "asc" }, take: 100 }) : Promise.resolve([]),
  ]);
  return { rows, categories, payments, templates, manager };
}
export type RecurringFields = {
  name: string; vendorName: string; amountCents: number; categoryId: string;
  paidFromAccountId: string; dayOfMonth: number; active: boolean;
};
export async function saveRecurringExpense(userId: string, input: RecurringFields, existingId?: string) {
  const fields = {
    name: name(input.name, "template name"), vendorName: name(input.vendorName, "vendor"),
    amountCents: cents(input.amountCents, "Recurring expense"), categoryId: name(input.categoryId, "category"),
    paidFromAccountId: name(input.paidFromAccountId, "payment account"), dayOfMonth: input.dayOfMonth,
    active: input.active,
  };
  if (!fields.amountCents || !Number.isSafeInteger(fields.dayOfMonth) || fields.dayOfMonth < 1 || fields.dayOfMonth > 28)
    throw new ExpenseInputError("Enter a positive monthly amount and day 1–28.");
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await validateReferences(tx, {
      spentOn: new Date(), amountCents: fields.amountCents, vendorTaxCents: 0,
      vendorName: fields.vendorName, categoryId: fields.categoryId, paidFromAccountId: fields.paidFromAccountId,
      memo: null, applianceId: null, jobId: null, purchaseOrderId: null, capitalizeToAppliance: false,
    });
    if (existingId) {
      await tx.$queryRaw`SELECT "id" FROM "RecurringExpense" WHERE "id" = ${existingId} FOR UPDATE`;
      const found = await tx.recurringExpense.findUnique({ where: { id: existingId } });
      if (!found) throw new ExpenseInputError("Recurring template no longer exists.");
      await tx.recurringExpense.update({ where: { id: existingId }, data: fields });
      await audit(tx, userId, existingId, "books.recurring.update", { active: fields.active });
      return existingId;
    }
    const created = await tx.recurringExpense.create({ data: fields });
    await audit(tx, userId, created.id, "books.recurring.create", { active: fields.active });
    return created.id;
  });
}
export async function createDueRecurringExpenses(now = new Date()): Promise<number> {
  const key = businessDateKey(now), month = key.slice(0, 7), day = Number(key.slice(-2));
  const owner = await prisma.user.findFirst({ where: { role: "OWNER", archivedAt: null }, select: { id: true } });
  if (!owner) throw new ExpenseInputError("Cannot create recurring drafts without an active owner.");
  let count = 0;
  const rows = await prisma.recurringExpense.findMany({ where: { active: true, dayOfMonth: { lte: day } },
    orderBy: { id: "asc" }, take: 251 });
  if (rows.length > 250) throw new ExpenseInputError("More than 250 active templates are due; investigate before advancing the month.");
  for (const row of rows) {
    const made = await prisma.$transaction(async tx => {
      await assertActiveTeamActor(tx, owner.id, ["OWNER"]);
      await tx.$queryRaw`SELECT "id" FROM "RecurringExpense" WHERE "id" = ${row.id} FOR UPDATE`;
      const current = await tx.recurringExpense.findUnique({ where: { id: row.id } });
      if (!current?.active || current.dayOfMonth > day || (current.lastCreatedFor && current.lastCreatedFor >= month))
        return false;
      const date = businessDateFromKey(month + "-" + String(current.dayOfMonth).padStart(2, "0"))!;
      await tx.expense.create({ data: {
        status: "DRAFT", spentOn: date, amountCents: current.amountCents, vendorTaxCents: 0,
        vendorName: current.vendorName, categoryId: current.categoryId,
        paidFromAccountId: current.paidFromAccountId, submittedByUserId: owner.id,
        recurringExpenseId: current.id, memo: "Recurring expense — confirm before posting",
      } });
      await tx.recurringExpense.update({ where: { id: row.id }, data: { lastCreatedFor: month } });
      await audit(tx, owner.id, row.id, "books.recurring.draft", { month });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (made) count++;
  }
  return count;
}
