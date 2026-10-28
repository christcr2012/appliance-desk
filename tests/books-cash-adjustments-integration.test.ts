import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { profitAndLoss } from "@/domains/books/reports";
import { createAdjustingEntry } from "@/domains/books/adjustments";
import { businessDateFromKey } from "@/lib/business-date";

// ACCT-1 (Codex round on PR #703): cash-basis P&L must not silently skip ADJUSTMENT entries.
// A pure income/expense reclassification (a paid expense recategorized) belongs in the cash
// figures; an adjustment touching balance-sheet accounts is left out WITH a review note.
const urlText = process.env.DATABASE_URL ?? "";
let enabled = false;
try {
  const u = new URL(urlText);
  enabled = process.env.CI === "true" && u.pathname === "/appliance_desk_test" && ["localhost", "127.0.0.1"].includes(u.hostname);
} catch { enabled = false; }

const tag = randomUUID().slice(0, 12);
const ownerId = "cashadj-owner-" + tag;
const accountantId = "cashadj-acct-" + tag;
const suppliesId = "cashadj-supplies-" + tag;
const repairsId = "cashadj-repairs-" + tag;
const day = (s: string) => businessDateFromKey(s)!;
const journalIds: string[] = [];
let bankId = "";
let oldStart: Date | null = null;

describe.skipIf(!enabled)("ACCT-1 cash-basis adjusting entries on real Postgres", () => {
  beforeAll(async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    oldStart = settings.booksStartDate;
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { booksStartDate: day("2026-01-01") } });
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: ownerId + "@example.test", role: "OWNER" },
        { id: accountantId, email: accountantId + "@example.test", role: "ACCOUNTANT" },
      ],
    });
    const bank = await prisma.ledgerAccount.findFirstOrThrow({ where: { systemRole: "BANK" }, select: { id: true } });
    bankId = bank.id;
    await prisma.ledgerAccount.createMany({
      data: [
        { id: suppliesId, name: "CashAdj supplies " + tag, type: "EXPENSE", description: "Disposable fixture" },
        { id: repairsId, name: "CashAdj repairs " + tag, type: "EXPENSE", description: "Disposable fixture" },
      ],
    });
    const entry = await prisma.journalEntry.create({
      data: {
        sourceType: "EXPENSE", sourceId: "cashadj-expense-" + tag, eventKind: "EXPENSE_POSTED",
        entryDate: day("2026-04-10"), periodKey: "2026-04", memo: "Paid supplies (disposable fixture)",
        lines: {
          create: [
            { ledgerAccountId: suppliesId, debitCents: 12000, creditCents: 0 },
            { ledgerAccountId: bankId, debitCents: 0, creditCents: 12000 },
          ],
        },
      },
    });
    journalIds.push(entry.id);
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({ where: { entryId: { in: journalIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: journalIds } } });
    await prisma.ledgerAccount.deleteMany({ where: { id: { in: [suppliesId, repairsId] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: [ownerId, accountantId] } }, { entityId: { in: [ownerId, accountantId] } }] } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, accountantId] } } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { booksStartDate: oldStart } });
  });

  it("a paid-expense reclassification by the accountant shows in the cash figures", async () => {
    const before = await profitAndLoss(ownerId, { from: "2026-04-01", to: "2026-04-30", basis: "CASH" });
    expect(before.summary.rows.find((r) => r.accountId === suppliesId)?.amountCents).toBe(12000);
    const { entryId } = await createAdjustingEntry(
      { kind: "person", userId: accountantId },
      {
        dateKey: "2026-04-20", memo: "Those supplies were repair parts",
        lines: [
          { accountId: repairsId, debitCents: 12000, creditCents: 0 },
          { accountId: suppliesId, debitCents: 0, creditCents: 12000 },
        ],
      },
    );
    journalIds.push(entryId);
    const after = await profitAndLoss(ownerId, { from: "2026-04-01", to: "2026-04-30", basis: "CASH" });
    expect(after.needsReview).toEqual([]);
    expect(after.summary.rows.find((r) => r.accountId === repairsId)?.amountCents).toBe(12000);
    expect(after.summary.rows.find((r) => r.accountId === suppliesId)?.amountCents ?? 0).toBe(0);
  });

  it("an adjusting entry dated before the Books opening date refuses", async () => {
    await expect(
      createAdjustingEntry(
        { kind: "person", userId: ownerId },
        {
          dateKey: "2025-12-15", memo: "Too early",
          lines: [
            { accountId: repairsId, debitCents: 100, creditCents: 0 },
            { accountId: suppliesId, debitCents: 0, creditCents: 100 },
          ],
        },
      ),
    ).rejects.toThrow(/books opening date/);
  });

  it("an adjustment touching the bank account is left out of cash figures WITH a review note", async () => {
    const entry = await prisma.journalEntry.create({
      data: {
        sourceType: "ADJUSTMENT", sourceId: "cashadj-bs-" + tag, eventKind: "MANUAL_ADJUSTMENT",
        entryDate: day("2026-04-22"), periodKey: "2026-04", memo: "Balance-sheet touching fixture",
        lines: {
          create: [
            { ledgerAccountId: bankId, debitCents: 5000, creditCents: 0 },
            { ledgerAccountId: suppliesId, debitCents: 0, creditCents: 5000 },
          ],
        },
      },
    });
    journalIds.push(entry.id);
    const cash = await profitAndLoss(ownerId, { from: "2026-04-01", to: "2026-04-30", basis: "CASH" });
    expect(cash.needsReview.some((note) => /balance-sheet accounts/.test(note))).toBe(true);
    expect(cash.summary.rows.find((r) => r.accountId === suppliesId)?.amountCents ?? 0).toBe(0);
    expect(cash.summary.rows.find((r) => r.accountId === repairsId)?.amountCents).toBe(12000);
  });
});
