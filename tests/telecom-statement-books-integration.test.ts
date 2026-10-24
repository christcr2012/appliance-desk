import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createExpense } from "@/domains/books/expenses";
import { bookTelecomStatementExpense } from "@/domains/messaging/telecom-statement-books";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";
const tag = randomUUID().replaceAll("-", "").slice(0, 10);
const ownerId = "n3-owner-" + tag, staffId = "n3-staff-" + tag, accountId = "n3-acct-" + tag;
const taxAccount = "n3-use-acct-" + tag, juris = "n3-jur-" + tag, location = "n3-loc-" + tag;
let categoryId = "", bankId = "", savedBooksStart: Date | null = null, savedElection = "UNDECIDED";
let currentLocations: string[] = [];
const statementIds: string[] = [];
const extraExpenses: string[] = [];

async function statement(over: Record<string, unknown> = {}) {
  const row = await prisma.telecomStatement.create({ data: {
    accountId, externalId: "S-" + randomUUID().slice(0, 8), periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30"),
    currency: "USD", invoiceTotalCents: 1755, issueDate: new Date("2026-10-03"),
    privateEvidenceStorageKey: "telecom-statements/x/y.pdf", evidenceHash: "a".repeat(64),
    ...(over.state === "DRAFT" ? {} : { state: "VERIFIED" as const, verifiedByUserId: ownerId, verifiedAt: new Date() }),
    ...over,
  } as Parameters<typeof prisma.telecomStatement.create>[0]["data"] });
  statementIds.push(row.id);
  return row;
}
const book = (id: string, over: Record<string, unknown> = {}) =>
  bookTelecomStatementExpense(ownerId, { statementId: id, paidOn: "2026-10-05", paidFromAccountId: bankId, categoryId, ...over });

describe.skipIf(!enabled)("COM-N3 verified phone statement becomes one books expense", () => {
  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerId, email: ownerId + "@example.test", role: "OWNER" },
      { id: staffId, email: staffId + "@example.test", role: "STAFF" },
    ] });
    await prisma.telecomAccount.create({ data: { id: accountId, provider: "twilio", environment: "TEST", externalAccountId: "AC" + "d".repeat(32), label: "N3 test" } });
    categoryId = (await prisma.expenseCategory.findFirstOrThrow({ where: { active: true } })).id;
    bankId = (await prisma.ledgerAccount.findUniqueOrThrow({ where: { systemRole: "BANK" } })).id;
    const s = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    savedBooksStart = s.booksStartDate; savedElection = s.shortTermLeaseElection;
    currentLocations = (await prisma.addressTaxLocation.findMany({ where: { forBusinessLocation: true, isCurrent: true }, select: { id: true } })).map((x) => x.id);
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { shortTermLeaseElection: "PAY_ON_ACQUISITION", booksStartDate: new Date("2026-01-01T07:00:00.000Z") } });
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: currentLocations } }, data: { isCurrent: false } });
    await prisma.taxFilingAccount.create({ data: { id: taxAccount, name: "N3 synthetic use tax", kind: "USE_TAX_RETURN", basis: "ACCRUAL" } });
    await prisma.taxJurisdiction.create({ data: { id: juris, code: "N3-" + tag, name: "N3 test city", level: "CITY", administration: "SELF_COLLECTED", reviewStatus: "REVIEWED", useTaxFilingAccountId: taxAccount } });
    await prisma.taxRateVersion.create({ data: { jurisdictionId: juris, rateMilliPercent: 5000, effectiveFrom: new Date("2026-01-01T07:00:00Z"), source: "MANUAL" } });
    await prisma.addressTaxLocation.create({ data: { id: location, forBusinessLocation: true, isCurrent: true, status: "VERIFIED", source: "MANUAL", lookedUpAt: new Date("2026-10-01T06:00:00Z"), jurisdictions: { create: [{ jurisdictionId: juris }] } } });
  });
  afterAll(async () => {
    const linked = await prisma.telecomStatement.findMany({ where: { id: { in: statementIds } }, select: { expenseId: true } });
    const expenseIds = [...linked.map((l) => l.expenseId).filter((x): x is string => !!x), ...extraExpenses];
    await prisma.telecomStatement.deleteMany({ where: { id: { in: statementIds } } });
    const memoExpenses = await prisma.expense.findMany({ where: { OR: [{ id: { in: expenseIds } }, { submittedByUserId: ownerId }] }, select: { id: true } });
    const ids = memoExpenses.map((e) => e.id);
    await prisma.journalLine.deleteMany({ where: { entry: { sourceType: "EXPENSE", sourceId: { in: ids } } } });
    await prisma.journalEntry.deleteMany({ where: { sourceType: "EXPENSE", sourceId: { in: ids } } });
    const taxIds = (await prisma.purchaseUseTax.findMany({ where: { sourceType: "EXPENSE", sourceId: { in: ids } }, select: { id: true } })).map((x) => x.id);
    await prisma.journalLine.deleteMany({ where: { entry: { sourceType: "USE_TAX", sourceId: { in: taxIds } } } });
    await prisma.journalEntry.deleteMany({ where: { sourceType: "USE_TAX", sourceId: { in: taxIds } } });
    await prisma.purchaseUseTax.deleteMany({ where: { sourceType: "EXPENSE", sourceId: { in: ids } } });
    await prisma.expense.deleteMany({ where: { id: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: [ownerId, staffId] } }, { entityId: { in: [...statementIds, ...ids] } }] } });
    await prisma.telecomAccount.deleteMany({ where: { id: accountId } });
    await prisma.addressTaxLocation.deleteMany({ where: { id: location } });
    await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId: juris } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: juris } });
    await prisma.taxFilingAccount.deleteMany({ where: { id: taxAccount } });
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: currentLocations } }, data: { isCurrent: true } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { shortTermLeaseElection: savedElection as "PAY_ON_ACQUISITION" | "COLLECT_ON_RENTALS" | "UNDECIDED", booksStartDate: savedBooksStart } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
  });

  it("refuses staff, unverified, credit and non-dollar statements, and books nothing", async () => {
    const ok = await statement();
    await expect(bookTelecomStatementExpense(staffId, { statementId: ok.id, paidOn: "2026-10-05", paidFromAccountId: bankId, categoryId })).rejects.toThrow(/access/);
    const draft = await statement({ state: "DRAFT" });
    await expect(book(draft.id)).rejects.toThrow(/Verify the statement/);
    await expect(book((await statement({ invoiceTotalCents: -500 })).id)).rejects.toThrow(/credit/);
    await expect(book((await statement({ currency: "CAD" })).id)).rejects.toThrow(/US-dollar/);
    await expect(book(ok.id, { paidOn: "not-a-day" })).rejects.toThrow(/day it was paid/);
    expect(await prisma.telecomStatement.count({ where: { id: { in: statementIds }, expenseId: { not: null } } })).toBe(0);
  });

  it("books exactly one posted Communications-style expense with the statement's total and tax, and repeating changes nothing", async () => {
    const row = await statement({ vendorTaxCents: 155 });
    const first = await book(row.id);
    expect(first).toMatchObject({ posted: true, linkedExisting: false });
    const again = await book(row.id);
    expect(again.expenseId).toBe(first.expenseId);
    const expense = await prisma.expense.findUniqueOrThrow({ where: { id: first.expenseId } });
    expect(expense).toMatchObject({ status: "POSTED", amountCents: 1755, vendorTaxCents: 155, vendorName: "Twilio", paidFromAccountId: bankId });
    expect(await prisma.expense.count({ where: { memo: { contains: `[telecom-statement ${row.id}]` } } })).toBe(1);
    expect(await prisma.journalEntry.count({ where: { sourceType: "EXPENSE", sourceId: first.expenseId } })).toBe(1);
    const linked = await prisma.telecomStatement.findUniqueOrThrow({ where: { id: row.id } });
    expect(linked.expenseId).toBe(first.expenseId);
    expect(linked.paidFromAccountId).toBe(bankId);
  });

  it("two clicks at once still make one expense", async () => {
    const row = await statement({ invoiceTotalCents: 2222 });
    const results = await Promise.allSettled([book(row.id), book(row.id)]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await prisma.expense.count({ where: { memo: { contains: `[telecom-statement ${row.id}]` }, status: { not: "VOID" } } })).toBe(1);
    expect(await prisma.journalEntry.count({ where: { sourceType: "EXPENSE", sourceId: (await prisma.telecomStatement.findUniqueOrThrow({ where: { id: row.id } })).expenseId! } })).toBe(1);
  });

  it("matches a bill that was already entered by hand instead of making a second one, and refuses a wrong amount or a bill already matched", async () => {
    const row = await statement({ invoiceTotalCents: 3333 });
    const manual = await createExpense(ownerId, { date: "2026-10-04", amountCents: 3333, vendorTaxCents: 0, vendorName: "Twilio (entered by hand)", categoryId, paidFromAccountId: bankId }, "POSTED");
    extraExpenses.push(manual.id);
    const wrong = await createExpense(ownerId, { date: "2026-10-04", amountCents: 3000, vendorTaxCents: 0, vendorName: "Twilio", categoryId, paidFromAccountId: bankId }, "DRAFT");
    extraExpenses.push(wrong.id);
    await expect(book(row.id, { linkExpenseId: wrong.id })).rejects.toThrow(/different amount/);
    const before = await prisma.expense.count({ where: { submittedByUserId: ownerId } });
    const out = await book(row.id, { linkExpenseId: manual.id });
    expect(out).toMatchObject({ expenseId: manual.id, linkedExisting: true, posted: true });
    expect(await prisma.expense.count({ where: { submittedByUserId: ownerId } })).toBe(before);
    const second = await statement({ invoiceTotalCents: 3333 });
    await expect(book(second.id, { linkExpenseId: manual.id })).rejects.toThrow(/already matched/);
  });
});
