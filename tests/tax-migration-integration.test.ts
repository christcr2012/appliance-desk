import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Prisma } from "@prisma/client";
import { BACKUP_TABLES } from "@/domains/backup/manifest";
import { prisma } from "@/lib/prisma";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const migration = readFileSync(
  "prisma/migrations/20261010010000_batch_t_sales_tax/migration.sql",
  "utf8",
);

const filingMigration = readFileSync(
  "prisma/migrations/20261010120000_batch_t_filing_workspace/migration.sql",
  "utf8",
);

describe.skipIf(!enabled)("Batch T tax migration (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `tax-migration-user-${tag}`;
  const customerId = `tax-migration-customer-${tag}`;
  const addressId = `tax-migration-address-${tag}`;
  const currentLocationId = `tax-migration-current-${tag}`;
  const businessLocationId = `tax-migration-business-${tag}`;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `${tag}@example.test`, role: "CUSTOMER" },
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        userId,
        referralCode: `TX${tag.slice(0, 10)}`,
      },
    });
    await prisma.serviceAddress.create({
      data: {
        id: addressId,
        customerId,
        line1: "1 Tax Migration Test Way",
        city: "Greeley",
        state: "CO",
        zip: "80631",
      },
    });
  });

  afterAll(async () => {
    await prisma.addressTaxLocation.deleteMany({
      where: {
        id: {
          in: [
            currentLocationId,
            `${currentLocationId}-duplicate`,
            businessLocationId,
            `${businessLocationId}-duplicate`,
          ],
        },
      },
    });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("seeds only undecided policy scaffolding", async () => {
    const colorado = await prisma.taxJurisdiction.findUnique({
      where: { code: "CO" },
      include: { rates: true },
    });
    expect(colorado).toMatchObject({
      name: "State of Colorado",
      level: "STATE",
      administration: "STATE_COLLECTED",
      reviewStatus: "REVIEWED",
    });
    expect(colorado?.rates).toHaveLength(0);

    const defaults = await prisma.taxabilityRule.findMany({
      where: { jurisdictionId: null },
      orderBy: { category: "asc" },
    });
    expect(defaults).toHaveLength(9);
    expect(new Set(defaults.map((row) => row.taxability))).toEqual(
      new Set(["UNDECIDED"]),
    );
    expect(new Set(defaults.map((row) => row.category))).toEqual(
      new Set([
        "RENTAL",
        "LATE_RETURN",
        "DELIVERY",
        "INSTALLATION",
        "REMOVAL",
        "DAMAGE_WAIVER",
        "EARLY_TERMINATION",
        "LATE_PAYMENT_FEE",
        "OTHER_CHARGE",
      ]),
    );
    expect(migration).not.toContain('INSERT INTO "TaxFilingAccount"');
  });

  it("gives existing business settings safe undecided defaults", async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    expect(settings.shortTermLeaseElection).toBe("UNDECIDED");
    expect(settings.retailDeliveryFeeDecision).toBe("UNDECIDED");
    expect(settings.businessTaxAddress).toEqual({});
  });

  it("partial unique index rejects a second default rule for one category", async () => {
    await expect(
      prisma.taxabilityRule.create({
        data: {
          id: `tax-duplicate-default-${tag}`,
          jurisdictionId: null,
          category: "RENTAL",
          taxability: "UNDECIDED",
        },
      }),
    ).rejects.toThrow();
  });

  it("partial unique index rejects two current locations for one service address", async () => {
    await prisma.addressTaxLocation.create({
      data: {
        id: currentLocationId,
        serviceAddressId: addressId,
        status: "NEEDS_REVIEW",
        source: "MANUAL",
        lookedUpAt: new Date("2026-10-06T12:00:00.000Z"),
      },
    });

    await expect(
      prisma.addressTaxLocation.create({
        data: {
          id: `${currentLocationId}-duplicate`,
          serviceAddressId: addressId,
          status: "NEEDS_REVIEW",
          source: "MANUAL",
          lookedUpAt: new Date("2026-10-06T12:01:00.000Z"),
        },
      }),
    ).rejects.toThrow();
  });

  it("partial unique index allows only one current business location", async () => {
    await prisma.addressTaxLocation.create({
      data: {
        id: businessLocationId,
        forBusinessLocation: true,
        status: "NEEDS_REVIEW",
        source: "MANUAL",
        lookedUpAt: new Date("2026-10-06T12:00:00.000Z"),
      },
    });

    await expect(
      prisma.addressTaxLocation.create({
        data: {
          id: `${businessLocationId}-duplicate`,
          forBusinessLocation: true,
          status: "NEEDS_REVIEW",
          source: "MANUAL",
          lookedUpAt: new Date("2026-10-06T12:01:00.000Z"),
        },
      }),
    ).rejects.toThrow();
  });

  it("creates new filing records with safe upgrade defaults and an amendment ledger", async () => {
    expect(filingMigration).toContain('ADD COLUMN "kind"');
    expect(filingMigration).toContain('ADD COLUMN "reminderDaysBefore"');
    expect(filingMigration).toContain('CREATE TABLE "TaxFilingAmendment"');
    expect(filingMigration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE/i);

    const account = await prisma.taxFilingAccount.create({
      data: { name: `Filing upgrade ${tag}` },
    });
    try {
      expect(account.kind).toBe("SALES_RETURN");
      expect(account.reminderDaysBefore).toEqual([7, 2]);
      expect(account.emailReminders).toBe(true);
      expect(account.deductionLabels).toEqual({});
      expect(account.screenLabels).toEqual({});
      expect(account.firstPeriodStart).toBeNull();

      const period = await prisma.taxFilingPeriod.create({
        data: {
          filingAccountId: account.id,
          periodStart: new Date("2026-08-01T06:00:00Z"),
          periodEnd: new Date("2026-09-01T06:00:00Z"),
          dueOn: new Date("2026-09-20T06:00:00Z"),
        },
      });
      try {
        expect(period.zeroReturn).toBe(false);
        expect(period.entryProgress).toEqual({});
        expect(period.legalDueOn).toBeNull();
        const amendment = await prisma.taxFilingAmendment.create({
          data: { periodId: period.id, sequence: 1, packet: { reason: "adjustment" }, additionalTaxCents: 125 },
        });
        expect(amendment.status).toBe("OPEN");
        await expect(prisma.taxFilingAmendment.create({
          data: { periodId: period.id, sequence: 1, packet: {}, additionalTaxCents: 125 },
        })).rejects.toThrow();
      } finally {
        await prisma.taxFilingAmendment.deleteMany({ where: { periodId: period.id } });
        await prisma.taxFilingPeriod.delete({ where: { id: period.id } });
      }
    } finally {
      await prisma.taxFilingAccount.delete({ where: { id: account.id } });
    }
  });

  it("backs up every Batch T table and schema health sees generated tax models", () => {
    expect(BACKUP_TABLES).toEqual(
      expect.arrayContaining([
        "taxFilingAccount",
        "taxJurisdiction",
        "taxRateVersion",
        "taxabilityRule",
        "addressTaxLocation",
        "addressTaxJurisdiction",
        "invoiceTaxLine",
        "customerTaxExemption",
        "taxFilingPeriod",
        "taxFilingAmendment",
        "purchaseUseTax",
      ]),
    );

    expect(Object.values(Prisma.ModelName)).toEqual(
      expect.arrayContaining([
        "TaxFilingAccount",
        "TaxJurisdiction",
        "TaxRateVersion",
        "TaxabilityRule",
        "AddressTaxLocation",
        "AddressTaxJurisdiction",
        "InvoiceTaxLine",
        "CustomerTaxExemption",
        "TaxFilingPeriod",
        "TaxFilingAmendment",
        "PurchaseUseTax",
      ]),
    );
  });
});
