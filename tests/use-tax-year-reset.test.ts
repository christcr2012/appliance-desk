import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import {
  advanceColoradoUseTaxFrequency,
  resetColoradoUseTaxFrequencyForNewYear,
} from "@/domains/tax/use-tax-frequency-transition";
import { listUseTaxResetAttention } from "@/domains/tax/filing-attention";

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

describe.skipIf(!enabled)("TFA-2 §7 use-tax year reset on real Postgres", () => {
  it("resets to annual on Jan 1, ignores last year's total in January, then switches on this year's total", async () => {
    const tag = randomUUID().slice(0, 8);
    const accountId = "tfa2-reset-acct-" + tag;
    const jurisdictionId = "tfa2-reset-jur-" + tag;
    const sourceBase = "tfa2-reset-pur-" + tag;
    let ruleVersionId = "";
    try {
      ruleVersionId = (await prisma.legalRuleVersion.create({
        data: {
          ruleKey: "co.use.monthly_threshold", value: 30000,
          effectiveFrom: day("2030-01-01"), origin: "OWNER", provisional: false,
        },
      })).id;
      await prisma.taxFilingAccount.create({
        data: {
          id: accountId, name: "State consumer use tax",
          kind: "USE_TAX_RETURN", frequency: "MONTHLY", basis: "ACCRUAL",
          firstPeriodStart: day("2030-01-01"), dueDayOfFollowingMonth: 20,
        },
      });
      await prisma.taxJurisdiction.create({
        data: {
          id: jurisdictionId, code: "R7-" + tag, name: "Test state",
          level: "STATE", administration: "STATE_COLLECTED",
          useTaxFilingAccountId: accountId, reviewStatus: "REVIEWED",
        },
      });
      const rate = await prisma.taxRateVersion.create({
        data: {
          jurisdictionId, rateMilliPercent: 5000,
          effectiveFrom: day("2030-01-01"), source: "MANUAL",
        },
      });
      const december = await prisma.taxFilingPeriod.create({
        data: {
          filingAccountId: accountId,
          periodStart: day("2030-12-01"), periodEnd: day("2030-12-31"),
          dueOn: day("2031-01-20"),
        },
      });
      // Last year finished over the $300 limit.
      await prisma.purchaseUseTax.create({
        data: {
          sourceType: "EXPENSE", sourceId: sourceBase + "dec", jurisdictionId,
          rateVersionId: rate.id, purchasedOn: day("2030-12-15"),
          purchaseAmountCents: 300010, vendorTaxCents: 0,
          useTaxDueCents: 30001, status: "DUE", filingPeriodId: december.id,
        },
      });

      // Jan 1: the reset fires once and is audited.
      expect(await resetColoradoUseTaxFrequencyForNewYear(accountId, day("2031-01-05"))).toBe(true);
      expect((await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id: accountId } })).frequency)
        .toBe("ANNUAL");
      expect(await prisma.auditLog.count({
        where: { action: "tax.use_tax_frequency.reset", entityId: accountId },
      })).toBe(1);
      expect(await resetColoradoUseTaxFrequencyForNewYear(accountId, day("2031-01-06"))).toBe(false);

      // January: last year's total must not re-trigger monthly filing — the
      // new year has no finished month yet.
      expect(await advanceColoradoUseTaxFrequency(accountId, day("2031-01-05"))).toBe(false);
      expect((await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id: accountId } })).frequency)
        .toBe("ANNUAL");
      expect(await prisma.auditLog.count({
        where: { action: "tax.use_tax_frequency.transition", entityId: accountId },
      })).toBe(0);

      // The calendar generates the year's annual period; January's own total
      // passes the limit, so the February run partitions it at Jan 31.
      const annual = await prisma.taxFilingPeriod.create({
        data: {
          filingAccountId: accountId,
          periodStart: day("2031-01-01"), periodEnd: day("2031-12-31"),
          dueOn: day("2032-01-20"),
        },
      });
      await prisma.purchaseUseTax.create({
        data: {
          sourceType: "EXPENSE", sourceId: sourceBase + "jan", jurisdictionId,
          rateVersionId: rate.id, purchasedOn: day("2031-01-15"),
          purchaseAmountCents: 300010, vendorTaxCents: 0,
          useTaxDueCents: 30001, status: "DUE", filingPeriodId: annual.id,
        },
      });
      expect(await advanceColoradoUseTaxFrequency(accountId, day("2031-02-02"))).toBe(true);
      expect((await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id: accountId } })).frequency)
        .toBe("MONTHLY");
      const january = await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: annual.id } });
      expect(businessDateKey(january.periodEnd)).toBe("2031-01-31");
      expect(businessDateKey(january.dueOn)).toBe("2031-02-20");
      expect(await advanceColoradoUseTaxFrequency(accountId, day("2031-02-03"))).toBe(false);
    } finally {
      await prisma.purchaseUseTax.deleteMany({ where: { sourceId: { startsWith: sourceBase } } });
      await prisma.taxFilingPeriod.deleteMany({ where: { filingAccountId: accountId } });
      await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId } });
      await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
      await prisma.taxFilingAccount.deleteMany({ where: { id: accountId } });
      await prisma.auditLog.deleteMany({ where: { entityId: accountId } });
      if (ruleVersionId) await prisma.legalRuleVersion.delete({ where: { id: ruleVersionId } });
    }
  });

  it("does not reset an account that never filed last year, or one whose new year already began", async () => {
    const tag = randomUUID().slice(0, 8);
    const freshId = "tfa2-fresh-acct-" + tag;
    const begunId = "tfa2-begun-acct-" + tag;
    const freshJur = "tfa2-fresh-jur-" + tag;
    const begunJur = "tfa2-begun-jur-" + tag;
    try {
      for (const [accountId, jurisdictionId, firstStart] of [
        [freshId, freshJur, "2031-01-01"],
        [begunId, begunJur, "2030-01-01"],
      ] as const) {
        await prisma.taxFilingAccount.create({
          data: {
            id: accountId, name: "State consumer use tax",
            kind: "USE_TAX_RETURN", frequency: "MONTHLY", basis: "ACCRUAL",
            firstPeriodStart: day(firstStart), dueDayOfFollowingMonth: 20,
          },
        });
        await prisma.taxJurisdiction.create({
          data: {
            id: jurisdictionId, code: "R7-" + tag + accountId.slice(5, 10), name: "Test state",
            level: "STATE", administration: "STATE_COLLECTED",
            useTaxFilingAccountId: accountId, reviewStatus: "REVIEWED",
          },
        });
      }
      await prisma.taxFilingPeriod.createMany({
        data: [
          {
            filingAccountId: begunId,
            periodStart: day("2030-12-01"), periodEnd: day("2030-12-31"),
            dueOn: day("2031-01-20"),
          },
          {
            filingAccountId: begunId,
            periodStart: day("2031-01-01"), periodEnd: day("2031-01-31"),
            dueOn: day("2031-02-20"),
          },
        ],
      });
      expect(await resetColoradoUseTaxFrequencyForNewYear(freshId, day("2031-06-01"))).toBe(false);
      expect(await resetColoradoUseTaxFrequencyForNewYear(begunId, day("2031-01-05"))).toBe(false);
      expect((await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id: begunId } })).frequency)
        .toBe("MONTHLY");
    } finally {
      await prisma.taxFilingPeriod.deleteMany({ where: { filingAccountId: { in: [freshId, begunId] } } });
      await prisma.taxJurisdiction.deleteMany({ where: { id: { in: [freshJur, begunJur] } } });
      await prisma.taxFilingAccount.deleteMany({ where: { id: { in: [freshId, begunId] } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [freshId, begunId] } } });
    }
  });

  it("shows the reset on Today for the current year until the account goes monthly again", async () => {
    const tag = randomUUID().slice(0, 8);
    const accountId = "tfa2-note-acct-" + tag;
    const jurisdictionId = "tfa2-note-jur-" + tag;
    const now = new Date();
    const year = businessDateKey(now).slice(0, 4);
    const lastYear = String(Number(year) - 1);
    try {
      await prisma.taxFilingAccount.create({
        data: {
          id: accountId, name: "State consumer use tax",
          kind: "USE_TAX_RETURN", frequency: "MONTHLY", basis: "ACCRUAL",
          firstPeriodStart: day(`${lastYear}-01-01`), dueDayOfFollowingMonth: 20,
        },
      });
      await prisma.taxJurisdiction.create({
        data: {
          id: jurisdictionId, code: "R7N-" + tag, name: "Test state",
          level: "STATE", administration: "STATE_COLLECTED",
          useTaxFilingAccountId: accountId, reviewStatus: "REVIEWED",
        },
      });
      await prisma.taxFilingPeriod.create({
        data: {
          filingAccountId: accountId,
          periodStart: day(`${lastYear}-12-01`), periodEnd: day(`${lastYear}-12-31`),
          dueOn: day(`${year}-01-20`),
        },
      });
      expect(await resetColoradoUseTaxFrequencyForNewYear(accountId, now)).toBe(true);
      const mine = (await listUseTaxResetAttention(now))
        .filter((item) => item.todoKey === `use-tax-reset:${accountId}:${year}`);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.title).toBe(`Use tax is back to one yearly return for ${year}`);

      await prisma.taxFilingAccount.update({
        where: { id: accountId }, data: { frequency: "MONTHLY" },
      });
      const after = (await listUseTaxResetAttention(now))
        .filter((item) => item.todoKey === `use-tax-reset:${accountId}:${year}`);
      expect(after).toHaveLength(0);
    } finally {
      await prisma.taxFilingPeriod.deleteMany({ where: { filingAccountId: accountId } });
      await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
      await prisma.taxFilingAccount.deleteMany({ where: { id: accountId } });
      await prisma.auditLog.deleteMany({ where: { entityId: accountId } });
    }
  });
});
