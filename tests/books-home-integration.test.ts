import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { collectedBetween } from "@/domains/billing/collected";
import { getBooksHome } from "@/domains/books/home";
import { profitAndLoss } from "@/domains/books/reports";

// AR-7 (BOOKS-TAXES 1.1): the Books overview's numbers must BE the report functions' numbers —
// same profitAndLoss (accrual) and collectedBetween the Reports page uses, on a seeded fixture.
let target: URL | null = null;
try { target = new URL(process.env.DATABASE_URL ?? ""); } catch { target = null; }
const enabled = process.env.CI === "true" && target !== null
  && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";

const tag = randomUUID().slice(0, 10);
const owner = "ar7-owner-" + tag;
const NOW = new Date("2026-10-28T18:00:00.000Z"); // Oct 28 in Denver
let original: {
  booksStartDate: Date | null; booksLastProblemCount: number; booksLastBroughtUpToDateAt: Date | null;
} | null = null;
const entryIds: string[] = [];
// Journal entries are business-wide, not per-user: other suites sharing this database post
// their own September/October entries, so the figures are asserted as DELTAS over a baseline
// captured before this suite's entries exist (this file is also in SHARED_SETTINGS_TESTS).
let baseOct = { incomeCents: 0, expenseCents: 0, netProfitCents: 0 };
let baseSep = { incomeCents: 0, expenseCents: 0, netProfitCents: 0 };
let baseCollectedOct = 0;

async function entry(onKey: string, lines: { accountId: string; debitCents: number; creditCents: number }[]) {
  const row = await prisma.journalEntry.create({
    data: {
      entryDate: new Date(onKey + "T06:00:00.000Z"),
      periodKey: onKey.slice(0, 7),
      sourceType: "ADJUSTMENT",
      sourceId: "ar7-" + tag + "-" + onKey,
      eventKind: "TEST",
      memo: "AR-7 books-home fixture",
      lines: { create: lines.map((l) => ({ ledgerAccountId: l.accountId, debitCents: l.debitCents, creditCents: l.creditCents })) },
    },
  });
  entryIds.push(row.id);
}

describe.skipIf(!enabled)("AR-7 books home on disposable PostgreSQL", () => {
  beforeAll(async () => {
    original = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { booksStartDate: true, booksLastProblemCount: true, booksLastBroughtUpToDateAt: true },
    });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { booksStartDate: new Date("2026-09-01T06:00:00.000Z"), booksLastProblemCount: 2, booksLastBroughtUpToDateAt: NOW },
    });
    await prisma.user.create({ data: { id: owner, email: owner + "@example.test", role: "OWNER" } });
    baseSep = (await profitAndLoss(owner, { from: "2026-09-01", to: "2026-09-30", basis: "ACCRUAL" })).summary;
    baseOct = (await profitAndLoss(owner, { from: "2026-10-01", to: "2026-10-28", basis: "ACCRUAL" })).summary;
    baseCollectedOct = (await collectedBetween(null, new Date("2026-10-01T06:00:00.000Z"), NOW)).netCents;
    const income = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: "INCOME", active: true } });
    const expense = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: "EXPENSE", active: true } });
    const asset = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: "ASSET", active: true } });
    await entry("2026-09-05", [
      { accountId: income.id, debitCents: 0, creditCents: 4000 },
      { accountId: asset.id, debitCents: 4000, creditCents: 0 },
    ]);
    await entry("2026-10-10", [
      { accountId: income.id, debitCents: 0, creditCents: 10000 },
      { accountId: asset.id, debitCents: 10000, creditCents: 0 },
    ]);
    await entry("2026-10-12", [
      { accountId: expense.id, debitCents: 2500, creditCents: 0 },
      { accountId: asset.id, debitCents: 0, creditCents: 2500 },
    ]);
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({ where: { entryId: { in: entryIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    await prisma.accountingPeriod.deleteMany({ where: { periodKey: "2026-09" } });
    await prisma.auditLog.deleteMany({ where: { userId: owner } });
    await prisma.user.deleteMany({ where: { id: owner } });
    if (original) await prisma.businessSettings.update({ where: { id: "singleton" }, data: original });
  });

  it("overview figures equal profitAndLoss and collectedBetween for both months", async () => {
    const home = await getBooksHome({ id: owner, role: "OWNER" }, NOW);
    expect(home.started).toBe(true);
    expect(home.problemCount).toBe(2);
    expect(home.thisMonth.billedCents - baseOct.incomeCents).toBe(10000);
    expect(home.thisMonth.spentCents - baseOct.expenseCents).toBe(2500);
    expect(home.thisMonth.profitCents - baseOct.netProfitCents).toBe(7500);
    expect(home.thisMonth.collectedCents - baseCollectedOct).toBe(0);
    expect(home.lastMonth.billedCents - baseSep.incomeCents).toBe(4000);
    expect(home.lastMonth.spentCents - baseSep.expenseCents).toBe(0);
    expect(home.lastMonth.profitCents - baseSep.netProfitCents).toBe(4000);

    const pnl = await profitAndLoss(owner, { from: "2026-10-01", to: "2026-10-28", basis: "ACCRUAL" });
    expect(home.thisMonth.billedCents).toBe(pnl.summary.incomeCents);
    expect(home.thisMonth.spentCents).toBe(pnl.summary.expenseCents);
    expect(home.thisMonth.profitCents).toBe(pnl.summary.netProfitCents);
    const collected = await collectedBetween(null, new Date("2026-10-01T06:00:00.000Z"), NOW);
    expect(home.thisMonth.collectedCents).toBe(collected.netCents);
  });

  it("months to review and the accountant package follow the period rows", async () => {
    const home = await getBooksHome({ id: owner, role: "OWNER" }, NOW);
    expect(home.monthsToReview).toEqual(["2026-09"]);
    expect(home.accountantPackageMonth).toBeNull();
    await prisma.accountingPeriod.create({
      data: { periodKey: "2026-09", status: "OPEN", accountantSentAt: NOW },
    });
    const sent = await getBooksHome({ id: owner, role: "OWNER" }, NOW);
    expect(sent.accountantPackageMonth).toBe("2026-09");
    expect(sent.monthsToReview).toEqual(["2026-09"]);
    await prisma.accountingPeriod.update({ where: { periodKey: "2026-09" }, data: { status: "CLOSED" } });
    const locked = await getBooksHome({ id: owner, role: "OWNER" }, NOW);
    expect(locked.monthsToReview).toEqual([]);
  });
});
