import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { postForSource } from "@/domains/books/post";
import {
  createExpense, getExpenses, postExpense, voidExpense,
  attachExpenseReceipt, saveRecurringExpense, createDueRecurringExpenses,
} from "@/domains/books/expenses";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";
const tag = randomUUID().slice(0, 8);
const owner = "k4-owner-" + tag, staff = "k4-staff-" + tag, other = "k4-other-" + tag;
const account = "k4-use-account-" + tag, juris = "k4-use-jur-" + tag, location = "k4-loc-" + tag;
const fixtureDate = "2026-10-17";
let categoryId = "", paidFromAccountId = "", savedElection = "UNDECIDED";
let savedBooksStart: Date | null = null;
let applianceId = "", templateId = "", currentLocations: string[] = [];
const expenseIds: string[] = [];
const input = (over: Record<string, unknown> = {}) => ({
  date: fixtureDate, amountCents: 10500, vendorTaxCents: 500,
  vendorName: "Synthetic hardware vendor", categoryId, paidFromAccountId,
  memo: "Synthetic expense", ...over,
});
describe.skipIf(!enabled)("K-4A/B expenses on disposable PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: owner, email: owner + "@example.test", role: "OWNER" },
      { id: staff, email: staff + "@example.test", role: "STAFF" },
      { id: other, email: other + "@example.test", role: "STAFF" },
    ] });
    const category = await prisma.expenseCategory.findFirstOrThrow({ where: { active: true } });
    const paid = await prisma.ledgerAccount.findUniqueOrThrow({ where: { systemRole: "BANK" } });
    categoryId = category.id; paidFromAccountId = paid.id;
    const oldSettings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    savedElection = oldSettings.shortTermLeaseElection;
    savedBooksStart = oldSettings.booksStartDate;
    currentLocations = (await prisma.addressTaxLocation.findMany({
      where: { forBusinessLocation: true, isCurrent: true }, select: { id: true },
    })).map(x => x.id);
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { shortTermLeaseElection: "PAY_ON_ACQUISITION", booksStartDate: new Date("2026-01-01T07:00:00.000Z") } });
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: currentLocations } }, data: { isCurrent: false } });
    await prisma.taxFilingAccount.create({ data: { id: account, name: "K4 synthetic use tax", kind: "USE_TAX_RETURN", basis: "ACCRUAL" } });
    await prisma.taxJurisdiction.create({ data: {
      id: juris, code: "K4-" + tag, name: "K4 test city", level: "CITY",
      administration: "SELF_COLLECTED", reviewStatus: "REVIEWED", useTaxFilingAccountId: account,
    } });
    await prisma.taxRateVersion.create({ data: {
      jurisdictionId: juris, rateMilliPercent: 5000, effectiveFrom: new Date("2026-01-01T07:00:00Z"), source: "MANUAL",
    } });
    await prisma.addressTaxLocation.create({ data: {
      id: location, forBusinessLocation: true, isCurrent: true, status: "VERIFIED",
      source: "MANUAL", lookedUpAt: new Date("2026-10-01T06:00:00Z"),
      jurisdictions: { create: [{ jurisdictionId: juris }] },
    } });
    const type = await prisma.applianceType.findFirstOrThrow({ select: { id: true } });
    applianceId = "k4-unit-" + tag;
    await prisma.appliance.create({ data: {
      id: applianceId, assetNumber: "K4-" + tag, applianceTypeId: type.id,
      acquisitionCostCents: 12000,
    } });
  });
  afterAll(async () => {
    const taxIds = (await prisma.purchaseUseTax.findMany({ where: {
      sourceType: "EXPENSE", sourceId: { in: expenseIds },
    }, select: { id: true } })).map(x => x.id);
    await prisma.journalLine.deleteMany({ where: { entry: {
      sourceType: "USE_TAX", sourceId: { in: taxIds },
    } } });
    await prisma.journalEntry.deleteMany({ where: { sourceType: "USE_TAX", sourceId: { in: taxIds } } });
    await prisma.journalLine.deleteMany({ where: { entry: {
      sourceType: "APPLIANCE", sourceId: applianceId,
    } } });
    await prisma.journalEntry.deleteMany({ where: { sourceType: "APPLIANCE", sourceId: applianceId } });
    await prisma.journalLine.deleteMany({ where: { entry: {
      sourceType: "EXPENSE", sourceId: { in: expenseIds },
    } } });
    await prisma.journalEntry.deleteMany({ where: { sourceType: "EXPENSE", sourceId: { in: expenseIds } } });
    await prisma.purchaseUseTax.deleteMany({ where: { sourceType: "EXPENSE", sourceId: { in: expenseIds } } });
    const photos = await prisma.expense.findMany({ where: { id: { in: expenseIds } }, select: { receiptPhotoId: true } });
    await prisma.expense.deleteMany({ where: { OR: [
      { id: { in: expenseIds } }, { recurringExpenseId: templateId || "__none__" },
    ] } });
    await prisma.photo.deleteMany({ where: { id: { in: photos.map(x=>x.receiptPhotoId).filter((x): x is string => !!x) } } });
    await prisma.recurringExpense.deleteMany({ where: { id: templateId || "__none__" } });
    await prisma.appliance.deleteMany({ where: { id: applianceId } });
    await prisma.auditLog.deleteMany({ where: { OR: [
      { userId: { in: [owner, staff, other] } },
      { entityId: templateId || "__none__" },
    ] } });
    await prisma.addressTaxLocation.deleteMany({ where: { id: location } });
    await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId: juris } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: juris } });
    await prisma.taxFilingAccount.deleteMany({ where: { id: account } });
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: currentLocations } }, data: { isCurrent: true } });
    await prisma.businessSettings.update({ where: { id: "singleton" },
      data: { shortTermLeaseElection: savedElection as "PAY_ON_ACQUISITION" | "COLLECT_ON_RENTALS" | "UNDECIDED", booksStartDate: savedBooksStart } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staff, other] } } });
  });
  it("enforces owned staff submission, role separation and cents/category validation", async () => {
    await expect(createExpense(staff, input(), "DRAFT")).rejects.toThrow(/Staff may submit/);
    await expect(createExpense(staff, input({ amountCents: 20.5 }), "SUBMITTED")).rejects.toThrow(/whole-cent/);
    await expect(createExpense(staff, input({ vendorTaxCents: 20000 }), "SUBMITTED")).rejects.toThrow(/exceeds/);
    await expect(createExpense(staff, input({ categoryId: "not-a-category" }), "SUBMITTED")).rejects.toThrow(/category/);
    await expect(createExpense(staff, input({ paidFromAccountId: categoryId }), "SUBMITTED")).rejects.toThrow(/account/);
    const saved = await createExpense(staff, input(), "SUBMITTED"); expenseIds.push(saved.id);
    expect((await getExpenses(staff)).rows.map(x=>x.id)).toContain(saved.id);
    expect((await getExpenses(other)).rows.map(x=>x.id)).not.toContain(saved.id);
    await expect(getExpenses("not-a-user")).rejects.toThrow(/workspace/);
    await expect(postExpense(staff, saved.id, 1)).rejects.toThrow(/access/);
    await expect(voidExpense(other, saved.id, 1, "not mine")).rejects.toThrow(/access/);
    expect(await prisma.journalEntry.count({ where: { sourceType: "EXPENSE", sourceId: saved.id } })).toBe(0);
  });
  it("rejects capitalized acquisition with conflicting appliance cost in one transaction", async () => {
    const created = await createExpense(owner, input({ applianceId, capitalizeToAppliance: true }), "DRAFT");
    expenseIds.push(created.id);
    await expect(postExpense(owner, created.id, 1)).rejects.toThrow(/different purchase cost/);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("DRAFT");
    expect(await prisma.journalEntry.count({ where: { sourceId: created.id } })).toBe(0);
  });
  it("refuses approval before owner initialization without recording a payment or journal", async () => {
    const draft = await createExpense(owner, input(), "DRAFT"); expenseIds.push(draft.id);
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { booksStartDate: null } });
    try {
      await expect(postExpense(owner, draft.id, 1)).rejects.toThrow(/Initialize books/);
      expect((await prisma.expense.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
      expect(await prisma.journalEntry.count({ where: { sourceId: draft.id } })).toBe(0);
    } finally {
      await prisma.businessSettings.update({ where: { id: "singleton" },
        data: { booksStartDate: new Date("2026-01-01T07:00:00.000Z") } });
    }
  });
  it("posts once across concurrent owners, records use tax, and preserves balanced reversal", async () => {
    const saved = await createExpense(staff, input({ vendorTaxCents: 100 }), "SUBMITTED"); expenseIds.push(saved.id);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => postExpense(owner, saved.id, 1)));
    expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
    let row = await prisma.expense.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row.status).toBe("POSTED");
    const entries = await prisma.journalEntry.findMany({ where: { sourceType: "EXPENSE", sourceId: saved.id }, include: { lines: true } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.lines.reduce((n, x) => n + x.debitCents - x.creditCents, 0)).toBe(0);
    const dueRows = await prisma.purchaseUseTax.findMany({ where: { sourceType: "EXPENSE", sourceId: saved.id } });
    expect(dueRows).toHaveLength(1);
    expect(dueRows[0]!.useTaxDueCents).toBeGreaterThan(0);
    await prisma.$transaction(tx => postForSource(tx, "USE_TAX", dueRows[0]!.id));
    expect(await prisma.journalEntry.count({ where: { sourceType: "USE_TAX", sourceId: dueRows[0]!.id } })).toBe(1);
    await expect(voidExpense(staff, saved.id, row.version, "my attempt")).rejects.toThrow(/access/);
    await expect(voidExpense(owner, saved.id, row.version, "")).rejects.toThrow(/reason/);
    await voidExpense(owner, saved.id, row.version, "Wrong source expense");
    row = await prisma.expense.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row.status).toBe("VOID");
    const after = await prisma.journalEntry.findMany({ where: { sourceType: "EXPENSE", sourceId: saved.id }, include: { lines: true } });
    expect(after.map(x=>x.eventKind).sort()).toEqual(["EXPENSE_POSTED","EXPENSE_VOIDED"]);
    expect(after.flatMap(x=>x.lines).reduce((n,x)=>n+x.debitCents-x.creditCents,0)).toBe(0);
    expect((await prisma.journalEntry.findMany({ where: {
      sourceType: "USE_TAX", sourceId: dueRows[0]!.id,
    } })).map(x => x.eventKind).sort()).toEqual(["USE_TAX_ACCRUED", "USE_TAX_VOIDED"]);
    expect((await prisma.purchaseUseTax.findUniqueOrThrow({ where: { id: dueRows[0]!.id } })).useTaxDueCents).toBe(0);
    await expect(voidExpense(owner, saved.id, row.version, "double submit")).rejects.toThrow(/unchanged, posted/);
  });
  it("preserves a pre-existing appliance acquisition and refuses double contribution journals", async () => {
    const matching = await createExpense(owner, input({ amountCents: 12000, applianceId, capitalizeToAppliance: true }), "DRAFT");
    expenseIds.push(matching.id);
    await postExpense(owner, matching.id, 1);
    const posted = await prisma.expense.findUniqueOrThrow({ where: { id: matching.id } });
    await voidExpense(owner, matching.id, posted.version, "Vendor receipt corrected");
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: applianceId } })).acquisitionCostCents).toBe(12000);
    await prisma.$transaction(tx => postForSource(tx, "APPLIANCE", applianceId));
    const second = await createExpense(owner, input({ amountCents: 12000, applianceId, capitalizeToAppliance: true }), "DRAFT");
    expenseIds.push(second.id);
    await expect(postExpense(owner, second.id, 1)).rejects.toThrow(/contribution was already booked/);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("DRAFT");
  });
  it("refuses forged/foreign private receipt attachment and keeps source scoped", async () => {
    const saved = await createExpense(staff, input(), "SUBMITTED"); expenseIds.push(saved.id);
    await expect(attachExpenseReceipt(owner, saved.id, "https://public.example/receipt")).rejects.toThrow(/not configured|not from/);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: saved.id } })).receiptPhotoId).toBeNull();
  });
  it("creates exactly one draft per Colorado month under concurrent attempts; pause means none", async () => {
    templateId = await saveRecurringExpense(owner, {
      name: "Synthetic storage", vendorName: "Storage locker", amountCents: 7500,
      categoryId, paidFromAccountId, dayOfMonth: 8, active: true,
    });
    await Promise.allSettled(Array.from({ length: 4 }, () =>
      createDueRecurringExpenses(new Date("2026-10-18T13:00:00Z"))));
    expect(await prisma.expense.count({ where: { recurringExpenseId: templateId } })).toBe(1);
    expect((await prisma.expense.findFirstOrThrow({ where: { recurringExpenseId: templateId } })).status).toBe("DRAFT");
    expect(await createDueRecurringExpenses(new Date("2026-10-18T13:00:00Z"))).toBe(0);
    expect(await createDueRecurringExpenses(new Date("2026-12-18T13:00:00Z"))).toBe(2);
    expect(await prisma.expense.count({ where: { recurringExpenseId: templateId } })).toBe(3);
    const template = await prisma.recurringExpense.findUniqueOrThrow({ where: { id: templateId } });
    expect(template.lastCreatedFor).toBe("2026-12");
    await saveRecurringExpense(owner, {
      name: template.name, vendorName: template.vendorName, amountCents: template.amountCents,
      categoryId, paidFromAccountId, dayOfMonth: template.dayOfMonth, active: false,
    }, template.id);
    expect(await createDueRecurringExpenses(new Date("2027-01-18T13:00:00Z"))).toBe(0);
  });
});
