import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { recordUseTaxForPurchase, assignDueUseTaxRowsToPeriod } from "@/domains/tax/use-tax";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";
const day = (value: string) => businessDateFromKey(value)!;

describe.skipIf(!enabled)("T-6b1 purchase use tax on real Postgres", () => {
  it("records verified purchase tax, allocates vendor tax, updates idempotently, and catches up unassigned rows", async () => {
    const token = randomUUID();
    const tag = token.slice(0, 8);
    const jurisdictionId = "t6-use-jurisdiction-" + token;
    const sourceId = "t6-use-purchase-" + token;
    const accountId = "t6-use-account-" + token;
    const locationId = "t6-use-location-" + token;
    const existing = await prisma.addressTaxLocation.findMany({
      where: { forBusinessLocation: true, isCurrent: true }, select: { id: true },
    });
    const originalSettings = await prisma.businessSettings.findUnique({
      where: { id: "singleton" }, select: { shortTermLeaseElection: true },
    });
    try {
      await prisma.businessSettings.upsert({
        where: { id: "singleton" },
        create: { shortTermLeaseElection: "PAY_ON_ACQUISITION" },
        update: { shortTermLeaseElection: "PAY_ON_ACQUISITION" },
      });
      await prisma.addressTaxLocation.updateMany({
        where: { id: { in: existing.map(x=>x.id) } }, data: { isCurrent: false },
      });
      await prisma.taxFilingAccount.create({
        data: { id: accountId, name: "Test use tax "+tag, kind: "USE_TAX_RETURN", basis: "ACCRUAL" },
      });
      await prisma.taxJurisdiction.create({
        data: {
          id: jurisdictionId, code: "T6-"+tag, name: "Test City", level: "CITY",
          administration: "SELF_COLLECTED", reviewStatus: "REVIEWED",
          useTaxFilingAccountId: accountId,
        },
      });
      const rate = await prisma.taxRateVersion.create({
        data: {
          jurisdictionId, rateMilliPercent: 5000,
          effectiveFrom: day("2026-01-01"), source: "MANUAL",
        },
      });
      await prisma.addressTaxLocation.create({
        data: {
          id: locationId, forBusinessLocation: true, isCurrent: true,
          status: "VERIFIED", source: "MANUAL", lookedUpAt: day("2026-09-01"),
          jurisdictions: { create: [{ jurisdictionId }] },
        },
      });
      const purchase = {
        sourceType: "APPLIANCE" as const, sourceId, purchasedOn: day("2026-09-18"),
        amountCents: 10000, vendorTaxCents: 200, isRentalInventory: true,
      };
      await prisma.$transaction(async tx => recordUseTaxForPurchase(tx, purchase));
      let result = await prisma.purchaseUseTax.findFirstOrThrow({ where: { sourceId } });
      expect(result.useTaxDueCents).toBe(300);
      expect(result.vendorTaxCents).toBe(200);
      expect(result.status).toBe("DUE");
      expect(result.filingPeriodId).toBeNull();
      await prisma.$transaction(async tx => recordUseTaxForPurchase(tx, purchase));
      expect(await prisma.purchaseUseTax.count({ where: { sourceId } })).toBe(1);

      const period = await prisma.taxFilingPeriod.create({
        data: { filingAccountId: accountId,
          periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"), dueOn: day("2026-10-20") },
      });
      expect(await prisma.$transaction(async tx =>
        assignDueUseTaxRowsToPeriod(tx, period.id),
      )).toBe(1);
      expect(await prisma.$transaction(async tx =>
        assignDueUseTaxRowsToPeriod(tx, period.id),
      )).toBe(0);
      result = await prisma.purchaseUseTax.findFirstOrThrow({ where: { sourceId } });
      expect(result.filingPeriodId).toBe(period.id);

      await prisma.$transaction(async tx =>
        recordUseTaxForPurchase(tx, { ...purchase, vendorTaxCents: 350 }),
      );
      result = await prisma.purchaseUseTax.findFirstOrThrow({ where: { sourceId } });
      expect(result.useTaxDueCents).toBe(150);

      await prisma.purchaseUseTax.update({ where: { id: result.id }, data: { status: "FILED" } });
      await expect(prisma.$transaction(async tx =>
        recordUseTaxForPurchase(tx, { ...purchase, vendorTaxCents: 400 }),
      )).rejects.toThrow(/amended return/i);

      await prisma.businessSettings.update({
        where: { id: "singleton" }, data: { shortTermLeaseElection: "COLLECT_ON_RENTALS" },
      });
      const anotherId = sourceId + "-collected";
      await prisma.$transaction(async tx =>
        recordUseTaxForPurchase(tx, { ...purchase, sourceId: anotherId, vendorTaxCents: 0 }),
      );
      const notDue = await prisma.purchaseUseTax.findFirstOrThrow({ where: { sourceId: anotherId } });
      expect(notDue.status).toBe("NOT_DUE");
    } finally {
      await prisma.purchaseUseTax.deleteMany({ where: { sourceId: { startsWith: sourceId } } });
      await prisma.taxFilingPeriod.deleteMany({ where: { filingAccountId: accountId } });
      await prisma.addressTaxLocation.deleteMany({ where: { id: locationId } });
      await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId } });
      await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
      await prisma.taxFilingAccount.deleteMany({ where: { id: accountId } });
      await prisma.addressTaxLocation.updateMany({
        where: { id: { in: existing.map(x=>x.id) } }, data: { isCurrent: true },
      });
      if (originalSettings) {
        await prisma.businessSettings.update({
          where: { id: "singleton" },
          data: { shortTermLeaseElection: originalSettings.shortTermLeaseElection },
        });
      }
    }
  });
});
