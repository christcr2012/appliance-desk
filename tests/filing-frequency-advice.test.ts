import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import {
  computeFilingFrequencyAdvice,
  confirmFilingFrequencyAdvice,
  frequencyAllowedByAverage,
} from "@/domains/tax/filing-frequency-advice";
import { runTaxFilingCalendar } from "@/domains/tax/filing-reminders";
import { listFilingFrequencyAdviceAttention } from "@/domains/tax/filing-attention";

function databaseUri(): URL | null {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
}
const uri = databaseUri();
const enabled = process.env.CI === "true" && uri !== null &&
  ["localhost", "127.0.0.1"].includes(uri.hostname) &&
  uri.pathname === "/appliance_desk_test";
const day = (s: string) => businessDateFromKey(s)!;
const THRESHOLDS = { annualMaxMonthlyCents: 5000, quarterlyMaxMonthlyCents: 110000 };

describe("TFA-2 §8 frequency thresholds (pure)", () => {
  it("maps the average to the most often Colorado allows", () => {
    expect(frequencyAllowedByAverage(5000, THRESHOLDS)).toBe("ANNUAL");
    expect(frequencyAllowedByAverage(5001, THRESHOLDS)).toBe("QUARTERLY");
    expect(frequencyAllowedByAverage(110000, THRESHOLDS)).toBe("QUARTERLY");
    expect(frequencyAllowedByAverage(110001, THRESHOLDS)).toBe("MONTHLY");
    expect(frequencyAllowedByAverage(0, THRESHOLDS)).toBe("ANNUAL");
  });
});

describe.skipIf(!enabled)("TFA-2 §8 filing-frequency advice on real Postgres", () => {
  async function fixture(frequency: "MONTHLY" | "QUARTERLY" | "ANNUAL") {
    const tag = randomUUID().slice(0, 8);
    const ownerId = "tfa2-ff-owner-" + tag;
    const staffId = "tfa2-ff-staff-" + tag;
    const userId = "tfa2-ff-user-" + tag;
    const customerId = "tfa2-ff-customer-" + tag;
    const jurisdictionId = "tfa2-ff-jur-" + tag;
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: tag + "-owner@example.test", name: "FF Owner", role: "OWNER", emailVerified: true },
        { id: staffId, email: tag + "-staff@example.test", name: "FF Staff", role: "STAFF", emailVerified: true },
        { id: userId, email: tag + "-customer@example.test", name: "FF Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({
      data: { id: customerId, userId, referralCode: "FF" + tag },
    });
    const account = await prisma.taxFilingAccount.create({
      data: {
        name: "Colorado sales tax " + tag, kind: "SALES_RETURN", frequency,
        basis: "ACCRUAL", firstPeriodStart: day("2030-01-01"), active: true,
      },
    });
    await prisma.taxJurisdiction.create({
      data: {
        id: jurisdictionId, code: "F8-" + tag, name: "Colorado state",
        level: "STATE", administration: "STATE_COLLECTED",
        reviewStatus: "REVIEWED", filingAccountId: account.id,
      },
    });
    const rate = await prisma.taxRateVersion.create({
      data: { jurisdictionId, rateMilliPercent: 5000, effectiveFrom: day("2025-01-01"), source: "MANUAL" },
    });
    async function addPeriod(startKey: string, endKey: string, taxCents: number) {
      const period = await prisma.taxFilingPeriod.create({
        data: {
          filingAccountId: account.id, periodStart: day(startKey), periodEnd: day(endKey),
          dueOn: day(endKey),
        },
      });
      const mid = new Date(day(startKey).getTime() + 10 * 24 * 3600 * 1000);
      const invoice = await prisma.invoice.create({
        data: {
          customerId, status: "PAID", issuedAt: mid, createdAt: mid,
          amountDueCents: 80000 + taxCents,
        },
      });
      await prisma.invoiceTaxLine.create({
        data: {
          invoiceId: invoice.id, jurisdictionId, rateVersionId: rate.id,
          category: "RENTAL", taxableCents: 80000, taxCents, source: "ENGINE",
        },
      });
      return period;
    }
    async function cleanup() {
      await prisma.filingFrequencyAdvice.deleteMany({ where: { filingAccountId: account.id } });
      await prisma.invoiceTaxLine.deleteMany({ where: { jurisdictionId } });
      await prisma.invoice.deleteMany({ where: { customerId } });
      await prisma.taxFilingPeriod.deleteMany({ where: { filingAccountId: account.id } });
      await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId } });
      await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
      await prisma.taxFilingAccount.deleteMany({ where: { id: account.id } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.auditLog.deleteMany({ where: { userId: { in: [ownerId, staffId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, userId] } } });
    }
    return { tag, ownerId, staffId, account, addPeriod, cleanup };
  }

  it("advises yearly filing from a low average, once, and the owner confirm applies it to future periods", async () => {
    const f = await fixture("MONTHLY");
    try {
      // Twelve closed months (2030-03 .. 2031-02) at $40 tax a month.
      const months: Array<[string, string]> = [
        ["2030-03-01", "2030-03-31"], ["2030-04-01", "2030-04-30"],
        ["2030-05-01", "2030-05-31"], ["2030-06-01", "2030-06-30"],
        ["2030-07-01", "2030-07-31"], ["2030-08-01", "2030-08-31"],
        ["2030-09-01", "2030-09-30"], ["2030-10-01", "2030-10-31"],
        ["2030-11-01", "2030-11-30"], ["2030-12-01", "2030-12-31"],
        ["2031-01-01", "2031-01-31"], ["2031-02-01", "2031-02-28"],
      ];
      for (const [start, end] of months) await f.addPeriod(start, end, 4000);

      const now = day("2031-03-01");
      // The producer is global (every sales account), so assert on this
      // account's rows, not the run total.
      expect(await computeFilingFrequencyAdvice(now)).toBeGreaterThanOrEqual(1);
      const advice = await prisma.filingFrequencyAdvice.findFirstOrThrow({
        where: { filingAccountId: f.account.id },
      });
      expect(advice).toMatchObject({
        currentFrequency: "MONTHLY", advisedFrequency: "ANNUAL",
        averageMonthlyCents: 4000, confirmedAt: null,
      });
      // Once per year: a second run adds nothing for this account.
      await computeFilingFrequencyAdvice(now);
      expect(await prisma.filingFrequencyAdvice.count({
        where: { filingAccountId: f.account.id },
      })).toBe(1);

      const items = (await listFilingFrequencyAdviceAttention(now))
        .filter((item) => item.todoKey === `filing-frequency-advice:${advice.id}`);
      expect(items).toHaveLength(1);
      expect(items[0]!.title).toContain("You may file yearly");
      expect(items[0]!.action).toMatchObject({ type: "CONFIRM_FILING_FREQUENCY", id: advice.id });

      // Staff cannot confirm; the owner can, exactly once.
      await expect(confirmFilingFrequencyAdvice(f.staffId, advice.id)).rejects.toThrow();
      await confirmFilingFrequencyAdvice(f.ownerId, advice.id);
      const updated = await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id: f.account.id } });
      expect(updated.frequency).toBe("ANNUAL");
      const confirmed = await prisma.filingFrequencyAdvice.findUniqueOrThrow({ where: { id: advice.id } });
      expect(confirmed.confirmedAt).not.toBeNull();
      expect(await prisma.auditLog.count({
        where: { action: "tax.filing_frequency.confirmed", entityId: f.account.id },
      })).toBe(1);
      await confirmFilingFrequencyAdvice(f.ownerId, advice.id);
      expect(await prisma.auditLog.count({
        where: { action: "tax.filing_frequency.confirmed", entityId: f.account.id },
      })).toBe(1);
      expect((await listFilingFrequencyAdviceAttention(now))
        .filter((item) => item.todoKey?.includes(advice.id))).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });

  it("raises more-often advice only in December", async () => {
    const g = await fixture("QUARTERLY");
    try {
      const quarters: Array<[string, string]> = [
        ["2031-01-01", "2031-03-31"], ["2031-04-01", "2031-06-30"],
        ["2031-07-01", "2031-09-30"],
      ];
      for (const [start, end] of quarters) await g.addPeriod(start, end, 400000);
      // October 1: the average says monthly, but that advice waits for December.
      await computeFilingFrequencyAdvice(day("2031-10-01"));
      expect(await prisma.filingFrequencyAdvice.count({
        where: { filingAccountId: g.account.id },
      })).toBe(0);
      // December: the advice appears, ahead of the January 1 move.
      await computeFilingFrequencyAdvice(day("2031-12-15"));
      expect(await prisma.filingFrequencyAdvice.count({
        where: { filingAccountId: g.account.id },
      })).toBe(1);
      const advice = await prisma.filingFrequencyAdvice.findFirstOrThrow({
        where: { filingAccountId: g.account.id },
      });
      expect(advice.advisedFrequency).toBe("MONTHLY");
      expect(advice.averageMonthlyCents).toBe(133333);
      const items = (await listFilingFrequencyAdviceAttention(day("2031-12-15")))
        .filter((item) => item.todoKey === `filing-frequency-advice:${advice.id}`);
      expect(items[0]!.title).toContain("Colorado may move you to monthly on Jan 1");
    } finally {
      await g.cleanup();
    }
  });

  it("does nothing mid-month outside December", async () => {
    const f = await fixture("MONTHLY");
    try {
      await f.addPeriod("2031-02-01", "2031-02-28", 100);
      expect(await computeFilingFrequencyAdvice(day("2031-03-15"))).toBe(0);
      expect(await prisma.filingFrequencyAdvice.count({
        where: { filingAccountId: f.account.id },
      })).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it("confirming yearly filing mid-year keeps every month covered (no gap)", async () => {
    const f = await fixture("MONTHLY");
    try {
      // Monthly periods through May 2031; the owner confirms yearly filing.
      const months: Array<[string, string]> = [
        ["2031-01-01", "2031-01-31"], ["2031-02-01", "2031-02-28"],
        ["2031-03-01", "2031-03-31"], ["2031-04-01", "2031-04-30"],
        ["2031-05-01", "2031-05-31"],
      ];
      for (const [start, end] of months) await f.addPeriod(start, end, 4000);
      const advice = await prisma.filingFrequencyAdvice.create({
        data: {
          filingAccountId: f.account.id, currentFrequency: "MONTHLY",
          advisedFrequency: "ANNUAL", averageMonthlyCents: 4000,
          computedOn: day("2031-06-01"),
        },
      });
      await confirmFilingFrequencyAdvice(f.ownerId, advice.id);
      // The rest of 2031 becomes one transition period, not a hole: period
      // generation skips ranges that overlap an existing period, so without
      // it June to December 2031 would have had no return at all.
      const after = await prisma.taxFilingPeriod.findMany({
        where: { filingAccountId: f.account.id },
        orderBy: [{ periodStart: "asc" }],
        select: { periodStart: true, periodEnd: true },
      });
      expect(after.map((p) => [businessDateKey(p.periodStart), businessDateKey(p.periodEnd)]))
        .toContainEqual(["2031-06-01", "2031-12-31"]);
      // The calendar then generates the first yearly period cleanly and
      // coverage stays continuous, with no gaps and no overlaps.
      await runTaxFilingCalendar(new Date("2032-01-05T12:00:00Z"));
      const all = await prisma.taxFilingPeriod.findMany({
        where: { filingAccountId: f.account.id },
        orderBy: [{ periodStart: "asc" }],
        select: { periodStart: true, periodEnd: true },
      });
      expect(all.map((p) => [businessDateKey(p.periodStart), businessDateKey(p.periodEnd)]))
        .toContainEqual(["2032-01-01", "2032-12-31"]);
      for (let i = 1; i < all.length; i++) {
        expect(all[i]!.periodStart.getTime())
          .toBe(all[i - 1]!.periodEnd.getTime() + 24 * 3600 * 1000);
      }
    } finally {
      await f.cleanup();
    }
  });

  it("a yearly account still gets December advice to file more often", async () => {
    const f = await fixture("ANNUAL");
    try {
      // A quiet year, then a big one. The yearly periods straddle the
      // trailing-twelve-months window edges, so whole-period selection
      // would see no evidence at all; overlap selection prorates them.
      await f.addPeriod("2030-01-01", "2030-12-31", 12000);
      await f.addPeriod("2031-01-01", "2031-12-31", 1600000);
      // Mid-year: more-often advice is December-only, nothing appears.
      await computeFilingFrequencyAdvice(day("2031-10-15"));
      expect(await prisma.filingFrequencyAdvice.count({
        where: { filingAccountId: f.account.id },
      })).toBe(0);
      // December: 1 month of the quiet year (1,000) plus 11 months of the
      // big year (1,466,667) over 12 months averages 122,305 — over the
      // quarterly limit, so Colorado may move this account to monthly.
      await computeFilingFrequencyAdvice(day("2031-12-15"));
      const advice = await prisma.filingFrequencyAdvice.findFirst({
        where: { filingAccountId: f.account.id },
      });
      expect(advice).toMatchObject({
        currentFrequency: "ANNUAL", advisedFrequency: "MONTHLY",
        averageMonthlyCents: 122305,
      });
    } finally {
      await f.cleanup();
    }
  });
});
