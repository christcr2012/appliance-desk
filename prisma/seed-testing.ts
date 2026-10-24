import { createHash } from "node:crypto";
import { assertTestingSeedEnvironment } from "../src/lib/testing-environment";
import { describeSeedFailure, initializeTestingSettings, initializeTestingSignIn, SeedStageError } from "./testing-settings";

// Refuse before importing Prisma/auth or making any database connection.
assertTestingSeedEnvironment();

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { TAX_CHARGE_CATEGORIES } = await import("../src/domains/tax/categories");
  const simulatedDate = new Date("2020-01-01T00:00:00Z");
  try {
    await prisma.$transaction(async tx => {
      try {
      // Serialize repeat deployments; add missing fixtures without resetting
      // payments, stock, credentials or completed testing work.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(174831, 902)::text`;
      await tx.businessSettings.upsert({ where: { id: "singleton" }, update: {}, create: {
        id: "singleton", publicBusinessName: "Robinson Appliance Rentals — TEST DATA", shortTermLeaseElection: "COLLECT_ON_RENTALS",
      } });
      const actor = await tx.user.upsert({ where: { email: "fixture-system@example.test" }, update: {}, create: {
        id: "testing-fixture-system", email: "fixture-system@example.test", name: "TEST fixture system (no login)", role: "OWNER", emailVerified: true,
      } });
      await initializeTestingSettings(tx, actor.id);
      await initializeTestingSignIn(tx, actor.id);
      for (const [slug, name] of [["washer", "Washer"], ["dryer", "Dryer"]] as const) {
        const type = await tx.applianceType.upsert({ where: { slug }, update: {}, create: { slug, name, monthlyPriceCents: 3500, showOnWebsite: false } });
        await tx.appliance.upsert({ where: { assetNumber: `TEST-${slug.toUpperCase()}-001` }, update: {}, create: {
          assetNumber: `TEST-${slug.toUpperCase()}-001`, applianceTypeId: type.id, manufacturer: "Fictional test manufacturer",
          acquisitionCostCents: 10000,
        } });
      }
      const jurisdiction = await tx.taxJurisdiction.upsert({ where: { code: "TEST-FICTIONAL-ZERO" }, update: {}, create: {
        id: "testing-tax-jurisdiction", code: "TEST-FICTIONAL-ZERO", name: "FICTIONAL TEST TAX AREA",
        level: "CITY", administration: "STATE_COLLECTED", reviewStatus: "REVIEWED",
        notes: "Synthetic fixture: not an actual rate, legal advice, or CPA approval.",
      } });
      await tx.taxRateVersion.upsert({ where: { id: "testing-tax-rate" }, update: {}, create: {
        id: "testing-tax-rate", jurisdictionId: jurisdiction.id, rateMilliPercent: 0, effectiveFrom: simulatedDate, source: "MANUAL",
      } });
      for (const category of TAX_CHARGE_CATEGORIES) {
        await tx.taxabilityRule.upsert({ where: { jurisdictionId_category: { jurisdictionId: jurisdiction.id, category } }, update: {}, create: {
          jurisdictionId: jurisdiction.id, category, taxability: "TAXABLE", cpaConfirmedOn: simulatedDate,
          reason: "FICTIONAL TEST FIXTURE: simulated confirmation, never actual CPA approval.",
        } });
      }
      await tx.addressTaxLocation.upsert({ where: { id: "testing-shop-tax-location" }, update: {}, create: {
        id: "testing-shop-tax-location", forBusinessLocation: true, status: "VERIFIED", source: "MANUAL", lookedUpAt: simulatedDate,
        reviewNote: "Synthetic testing shop, not a business address.", jurisdictions: { create: { jurisdictionId: jurisdiction.id } },
      } });
      for (const n of [1, 2, 3]) {
        const user = await tx.user.upsert({ where: { email: `customer${n}@example.test` }, update: {}, create: {
          id: `testing-customer-user-${n}`, email: `customer${n}@example.test`, name: `TEST Customer ${n}`, role: "CUSTOMER", emailVerified: true,
        } });
        const customer = await tx.customer.upsert({ where: { userId: user.id }, update: {}, create: {
          id: `testing-customer-${n}`, userId: user.id, referralCode: `TEST-CUSTOMER-${n}`,
        } });
        await tx.serviceAddress.upsert({ where: { id: `testing-address-${n}` }, update: {}, create: {
          id: `testing-address-${n}`, customerId: customer.id, line1: `${n} Fictional Test Lane`, city: "Test City", zip: "00000",
        } });
        await tx.addressTaxLocation.upsert({ where: { id: `testing-address-tax-${n}` }, update: {}, create: {
          id: `testing-address-tax-${n}`, serviceAddressId: `testing-address-${n}`, status: "VERIFIED", source: "MANUAL", lookedUpAt: simulatedDate,
          reviewNote: "Synthetic address only.", jurisdictions: { create: { jurisdictionId: jurisdiction.id } },
        } });
      }
      if (!await tx.partRecord.findUnique({ where: { id: "testing-dollar-part" } })) {
        await tx.partRecord.create({ data: { id: "testing-dollar-part", modelNumber: "TEST-MODEL", partNumber: "TEST-DOLLAR",
          partName: "TEST ONLY — $1 checkout item", sellable: true, retailPriceCents: 100, quantityOnHand: 10,
          notes: "Fictional stock for payment verification." } });
        await tx.partStockMovement.create({ data: { partRecordId: "testing-dollar-part", kind: "ADJUSTMENT", quantityDelta: 10, balanceAfter: 10,
          operationKey: "testing-initial-stock", payloadHash: createHash("sha256").update("testing-initial-stock").digest("hex"),
          createdByUserId: actor.id, reason: "Synthetic testing inventory" } });
      }
      } catch (error) { throw new SeedStageError("adding the fictional fixtures", error); }
    }, { timeout: 30000 });
    // Separate owner credential; no production users, hashes or MFA secrets.
    const password = process.env.TEST_OWNER_PASSWORD;
    if (password) try {
      if (password.length < 16) throw new Error("TEST_OWNER_PASSWORD must be at least 16 characters.");
      const { createTrustedCredentialUserInTx } = await import("../src/lib/account-provisioning");
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(174831, 903)::text`;
        if (!await tx.user.findUnique({ where: { email: "owner@example.test" } })) {
          await createTrustedCredentialUserInTx(tx, { email: "owner@example.test", name: "Testing Owner", role: "OWNER", password, emailVerified: true });
        }
      }, { timeout: 30000 });
    } catch (error) { throw new SeedStageError("creating the test owner login", error); }
    console.log("Synthetic testing fixtures ready. Existing test history was preserved.");
    if (!password) console.log("Test owner login awaits TEST_OWNER_PASSWORD; no business identity was copied.");
  } finally { await prisma.$disconnect(); }
}

main().catch(error => { console.error("Testing seed failed: " + describeSeedFailure(error)); process.exitCode = 1; });
