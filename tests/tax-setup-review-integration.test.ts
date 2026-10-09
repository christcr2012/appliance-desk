import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveTaxSettings, saveTaxabilityCell, saveTaxFilingAccount } from "@/domains/tax/setup";

const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(db.hostname)
  && db.pathname === "/appliance_desk_test";
async function ownerFixture(run: (id: string) => Promise<void>) {
  const key = randomUUID().replaceAll("-", "");
  const owner = await prisma.user.create({ data: {
    email: key + "@taxreview.example.test", name: "Review fixture", role: "OWNER",
    passwordHash: "test-only",
  } });
  try { await run(owner.id); } finally {
    await prisma.auditLog.deleteMany({ where: { userId: owner.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  }
}

describe.skipIf(!enabled)("T-7A P1 review fixes in isolated PostgreSQL", () => {
  it("changing a verified business address invalidates all old current tax mappings", async () =>
    ownerFixture(async id => {
      const before = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
      const prior = await prisma.addressTaxLocation.findMany({ where: { forBusinessLocation: true, isCurrent: true } });
      const current = await prisma.addressTaxLocation.create({ data: {
        forBusinessLocation: true, isCurrent: true, lookedUpAt: new Date(),
        status: "VERIFIED", source: "MANUAL",
      } });
      try {
        await saveTaxSettings(id, {
          shortTermLeaseElection: before.shortTermLeaseElection,
          shortTermLeaseElectionNote: before.shortTermLeaseElectionNote,
          rdfHandling: before.rdfHandling, rdfThresholdCents: before.rdfThresholdCents,
          rdfCpaConfirmedOn: before.rdfCpaConfirmedOn,
          autoApplyOfficialRateChanges: before.autoApplyOfficialRateChanges,
          autoRateChangeMaxMilliPercent: before.autoRateChangeMaxMilliPercent,
          businessLocation: { line1: "1 Fixture St", city: "Greeley", state: "CO", zip: "80631" },
        }, before.updatedAt);
        expect((await prisma.addressTaxLocation.findUniqueOrThrow({ where: { id: current.id } })).isCurrent).toBe(false);
        const next = await prisma.addressTaxLocation.findFirstOrThrow({
          where: { forBusinessLocation: true, isCurrent: true },
          orderBy: { createdAt: "desc" },
        });
        expect(next.status).toBe("NEEDS_REVIEW");
        expect(next.reviewNote).toMatch(/recheck|confirm/i);
      } finally {
        await prisma.addressTaxLocation.deleteMany({
          where: { forBusinessLocation: true, id: { notIn: [...prior.map(x => x.id)] } },
        });
        await prisma.addressTaxLocation.updateMany({
          where: { id: { in: prior.map(x => x.id) } }, data: { isCurrent: true },
        });
        await prisma.businessSettings.update({ where: { id: "singleton" }, data: {
          businessTaxAddress: before.businessTaxAddress ?? {},
        } });
      }
    }));

  it("owner can confirm all-state default rules without inventing a jurisdiction ID", async () =>
    ownerFixture(async id => {
      const before = await prisma.taxabilityRule.findFirstOrThrow({
        where: { jurisdictionId: null }, orderBy: { id: "asc" },
      });
      try {
        await saveTaxabilityCell(id, {
          jurisdictionId: null, category: before.category,
          taxability: "TAXABLE", cpaConfirmedOn: new Date("2026-07-01"),
          reason: "Synthetic CPA decision",
        });
        expect(await prisma.taxabilityRule.findUniqueOrThrow({ where: { id: before.id } }))
          .toMatchObject({ taxability: "TAXABLE", reason: "Synthetic CPA decision" });
        expect(await prisma.taxabilityRule.count({
          where: { jurisdictionId: null, category: before.category },
        })).toBe(1);
      } finally {
        await prisma.taxabilityRule.update({ where: { id: before.id }, data: {
          taxability: before.taxability, reason: before.reason,
          cpaConfirmedOn: before.cpaConfirmedOn, updatedByUserId: before.updatedByUserId,
        } });
      }
    }));

  it("SUTS license, labels, uploads, confirmation and ordered area code all persist", async () =>
    ownerFixture(async id => {
      const code = "T7A-" + randomUUID().replaceAll("-", "");
      const area = await prisma.taxJurisdiction.create({ data: {
        code, name: "Account fixture area", level: "CITY",
        administration: "STATE_COLLECTED", reviewStatus: "REVIEWED",
      } });
      let accountId: string | null = null;
      try {
        const row = await saveTaxFilingAccount(id, {
          id: null, name: "SUTS advanced " + code,
          kind: "SALES_RETURN", frequency: "MONTHLY", basis: "CASH",
          accountNumber: "TEST-123", portalUrl: "https://colorado.gov",
          dueDayOfFollowingMonth: 20, firstPeriodStart: new Date("2026-01-01"),
          emailReminders: true, reminderDaysBefore: [7], active: true, filingNotes: "Fixture only",
          licenseExpiresOn: new Date("2027-07-01"),
          screenLabels: { grossSales: "Gross receipts" },
          deductionLabels: { OUTSIDE_AREA: { label: "Outside area", reportAs: "DEDUCTION" } },
          excelUploadAvailable: true, bulkXmlAvailable: false,
          setupCheckedOn: new Date("2026-10-01"),
          areaAssignments: [{
            jurisdictionId: area.id, mode: "SALES", filingCode: "SUTS-G",
            filingOrder: 2, serviceFeeMilliPercent: 1000,
          }],
        }, null);
        accountId = row.id;
        expect(await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id: row.id } }))
          .toMatchObject({
            licenseExpiresOn: new Date("2027-07-01"), excelUploadAvailable: true,
            bulkXmlAvailable: false,
            screenLabels: { grossSales: "Gross receipts" },
            deductionLabels: { OUTSIDE_AREA: { label: "Outside area", reportAs: "DEDUCTION" } },
          });
        expect(await prisma.taxJurisdiction.findUniqueOrThrow({ where: { id: area.id } }))
          .toMatchObject({
            filingAccountId: row.id, filingCode: "SUTS-G",
            filingOrder: 2, serviceFeeMilliPercent: 1000,
          });
      } finally {
        await prisma.taxJurisdiction.delete({ where: { id: area.id } });
        if (accountId) await prisma.taxFilingAccount.delete({ where: { id: accountId } });
      }
    }));
});

