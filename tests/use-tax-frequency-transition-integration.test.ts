import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { advanceColoradoUseTaxFrequency } from "@/domains/tax/use-tax-frequency-transition";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";
const day = (value: string) => businessDateFromKey(value)!;

describe.skipIf(!enabled)("T-6D3 use-tax frequency migration on real Postgres", () => {
  it("partitions open annual period, detaches later purchases and is idempotent", async () => {
    const tag = randomUUID().slice(0, 8);
    const accountId = "t6d3-acct-" + tag;
    const jurisdictionId = "t6d3-jur-" + tag;
    const sourceBase = "t6d3-pur-" + tag;
    const settings = await prisma.businessSettings.findUnique({
      where: { id: "singleton" }, select: { useTaxMonthlyThresholdCents: true },
    });
    try {
      await prisma.businessSettings.upsert({
        where: { id: "singleton" },
        create: { useTaxMonthlyThresholdCents: 30000 },
        update: { useTaxMonthlyThresholdCents: 30000 },
      });
      await prisma.taxFilingAccount.create({
        data: { id: accountId, name: "State consumer use tax",
          kind: "USE_TAX_RETURN", frequency: "ANNUAL", basis: "ACCRUAL",
          firstPeriodStart: day("2026-01-01"), dueDayOfFollowingMonth: 20 },
      });
      await prisma.taxJurisdiction.create({
        data: { id: jurisdictionId, code: "D3-"+tag, name: "Test state",
          level: "STATE", administration: "STATE_COLLECTED",
          useTaxFilingAccountId: accountId, reviewStatus: "REVIEWED" },
      });
      const rate = await prisma.taxRateVersion.create({
        data: { jurisdictionId, rateMilliPercent: 5000,
          effectiveFrom: day("2026-01-01"), source: "MANUAL" },
      });
      const annual = await prisma.taxFilingPeriod.create({
        data: { filingAccountId: accountId,
          periodStart: day("2026-01-01"), periodEnd: day("2026-12-31"),
          dueOn: day("2027-01-20") },
      });
      for (const [index, date, amount] of [
        [1, "2026-09-10", 15000],
        [2, "2026-09-20", 16000],
        [3, "2026-10-05", 100],
      ] as const) {
        await prisma.purchaseUseTax.create({
          data: {
            sourceType: "EXPENSE", sourceId: sourceBase + index, jurisdictionId,
            rateVersionId: rate.id, purchasedOn: day(date),
            purchaseAmountCents: amount * 10, vendorTaxCents: 0,
            useTaxDueCents: amount, status: "DUE", filingPeriodId: annual.id,
          },
        });
      }
      // A filing transaction holds the same period row lock and commits FILED
      // while the calendar is attempting its month-end partition.
      let signalLocked!: () => void;
      let releaseFiling!: () => void;
      const locked = new Promise<void>(resolve => { signalLocked = resolve; });
      const release = new Promise<void>(resolve => { releaseFiling = resolve; });
      const filing = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "TaxFilingPeriod" WHERE "id" = ${annual.id} FOR UPDATE`;
        signalLocked();
        await release;
        await tx.taxFilingPeriod.update({
          where: { id: annual.id }, data: { status: "FILED" },
        });
      });
      await locked;
      const racingTransition = advanceColoradoUseTaxFrequency(accountId, day("2026-10-08"));
      // Give the concurrent reader an opportunity to reach the row lock;
      // correctness must hold even when it reaches the row after FILED.
      await new Promise(resolve => setTimeout(resolve, 75));
      releaseFiling();
      await filing;
      await expect(racingTransition).rejects.toThrow(/filed annual return/i);
      const preserved = await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: annual.id } });
      expect(businessDateKey(preserved.periodEnd)).toBe("2026-12-31");
      expect(preserved.status).toBe("FILED");
      expect((await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id: accountId } })).frequency)
        .toBe("ANNUAL");
      await prisma.taxFilingPeriod.update({
        where: { id: annual.id }, data: { status: "OPEN" },
      });

      expect(await advanceColoradoUseTaxFrequency(accountId, day("2026-10-08"))).toBe(true);
      const saved = await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: annual.id } });
      expect(businessDateKey(saved.periodEnd)).toBe("2026-09-30");
      expect(businessDateKey(saved.dueOn)).toBe("2026-10-20");
      const account = await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id: accountId } });
      expect(account.frequency).toBe("MONTHLY");
      const assigned = await prisma.purchaseUseTax.findMany({
        where: { sourceId: { startsWith: sourceBase } },
        orderBy: { sourceId: "asc" },
      });
      expect(assigned.map(x => x.filingPeriodId)).toEqual([annual.id, annual.id, null]);
      expect(await advanceColoradoUseTaxFrequency(accountId, day("2026-10-08"))).toBe(false);
      expect(await prisma.auditLog.count({
        where: { action: "tax.use_tax_frequency.transition", entityId: accountId },
      })).toBe(1);
    } finally {
      await prisma.purchaseUseTax.deleteMany({ where: { sourceId: { startsWith: sourceBase } } });
      await prisma.taxFilingPeriod.deleteMany({ where: { filingAccountId: accountId } });
      await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId } });
      await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
      await prisma.taxFilingAccount.deleteMany({ where: { id: accountId } });
      await prisma.auditLog.deleteMany({ where: { entityId: accountId, action: "tax.use_tax_frequency.transition" } });
      if (settings) {
        await prisma.businessSettings.update({
          where: { id: "singleton" },
          data: { useTaxMonthlyThresholdCents: settings.useTaxMonthlyThresholdCents },
        });
      }
    }
  });
});
