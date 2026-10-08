import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/domains/messaging/owner-alerts", () => ({ sendOwnerAlert: vi.fn(async () => {}) }));
vi.mock("@/lib/session", () => ({ requireRole: vi.fn(async () => ({ user: { id: "test-owner", role: "OWNER" } })) }));
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { createApplianceUnits } from "@/domains/inventory";
import { recordApplianceAcquisitionTax } from "@/domains/tax/acquisition";
import { loadFilingPacket } from "@/domains/tax/filing-packet";
import { detectTaxFilingAmendments, markPeriodFiled } from "@/domains/tax/filing";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true"
  && ["localhost", "127.0.0.1"].includes(url.hostname)
  && url.pathname === "/appliance_desk_test";
const day = (s: string) => businessDateFromKey(s)!;
const tag = randomUUID().replaceAll("-", "");
const userId = "acq-owner-" + tag;
const typeId = "acq-type-" + tag;
const jurId = "acq-jur-" + tag;
const accountId = "acq-account-" + tag;
const locationId = "acq-location-" + tag;
const prefix = "ACQT";

describe.skipIf(!enabled)("T-6D1 appliance purchase-tax evidence on real PostgreSQL", () => {
  let oldLocations: string[] = [];
  let oldElection: "UNDECIDED" | "PAY_ON_ACQUISITION" | "COLLECT_ON_RENTALS" | null = null;
  const acquiredIds: string[] = [];
  const periodIds: string[] = [];

  beforeAll(async () => {
    oldLocations = (await prisma.addressTaxLocation.findMany({
      where: { forBusinessLocation: true, isCurrent: true }, select: { id: true },
    })).map(row => row.id);
    const oldSettings = await prisma.businessSettings.findUnique({
      where: { id: "singleton" }, select: { shortTermLeaseElection: true },
    });
    oldElection = oldSettings?.shortTermLeaseElection ?? null;
    await prisma.user.create({
      data: { id: userId, email: tag + "@example.test", name: "Acquisition tester", role: "OWNER" },
    });
    await prisma.applianceType.create({
      data: { id: typeId, name: "Acqt", slug: "acqt-" + tag, monthlyPriceCents: 1500 },
    });
    await prisma.businessSettings.upsert({
      where: { id: "singleton" },
      create: { shortTermLeaseElection: "PAY_ON_ACQUISITION" },
      update: { shortTermLeaseElection: "PAY_ON_ACQUISITION" },
    });
    await prisma.addressTaxLocation.updateMany({
      where: { id: { in: oldLocations } }, data: { isCurrent: false },
    });
    await prisma.taxFilingAccount.create({
      data: { id: accountId, name: "Acquisition tax " + tag, kind: "USE_TAX_RETURN", basis: "ACCRUAL" },
    });
    await prisma.taxJurisdiction.create({
      data: { id: jurId, code: "ACQ-" + tag.slice(0, 6), name: "Acquisition test jurisdiction",
        level: "CITY", administration: "SELF_COLLECTED",
        reviewStatus: "REVIEWED", useTaxFilingAccountId: accountId },
    });
    await prisma.taxRateVersion.create({
      data: { jurisdictionId: jurId, rateMilliPercent: 5000,
        effectiveFrom: day("2026-01-01"), source: "MANUAL" },
    });
    await prisma.addressTaxLocation.create({
      data: { id: locationId, forBusinessLocation: true, isCurrent: true,
        status: "VERIFIED", source: "MANUAL", lookedUpAt: day("2026-09-01"),
        jurisdictions: { create: [{ jurisdictionId: jurId }] } },
    });
  });

  afterAll(async () => {
    await prisma.taxFilingAmendment.deleteMany({ where: { periodId: { in: periodIds } } });
    await prisma.purchaseUseTax.deleteMany({ where: { sourceType: "APPLIANCE", sourceId: { in: acquiredIds } } });
    await prisma.taxFilingPeriod.deleteMany({ where: { id: { in: periodIds } } });
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.photo.deleteMany({ where: { applianceId: { in: acquiredIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: acquiredIds } } });
    await prisma.assetNumberCounter.deleteMany({ where: { prefix } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.addressTaxLocation.deleteMany({ where: { id: locationId } });
    await prisma.addressTaxLocation.updateMany({
      where: { id: { in: oldLocations } }, data: { isCurrent: true },
    });
    await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId: jurId } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: jurId } });
    await prisma.taxFilingAccount.deleteMany({ where: { id: accountId } });
    if (oldElection !== null) {
      await prisma.businessSettings.update({
        where: { id: "singleton" }, data: { shortTermLeaseElection: oldElection },
      });
    }
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function add(quantity = 1, extras: Parameters<typeof createApplianceUnits>[1] = {
    applianceTypeId: typeId, quantity,
  }) {
    const rows = await createApplianceUnits(userId, { ...extras, applianceTypeId: typeId, quantity });
    acquiredIds.push(...rows.map(row => row.id));
    return rows;
  }

  it("historical or unspecified acquisition evidence remains unknown", async () => {
    const [unit] = await add();
    expect(unit.acquisitionTaxStatus).toBe("UNKNOWN");
    expect(unit.acquisitionTaxRecordedAt).toBeNull();
    expect(await prisma.purchaseUseTax.count({
      where: { sourceType: "APPLIANCE", sourceId: unit.id },
    })).toBe(0);
  });

  it("splits total bulk seller-tax cents exactly and records each unit", async () => {
    const units = await add(3, {
      applianceTypeId: typeId, quantity: 3,
      purchaseDate: day("2026-09-18"), acquisitionCostCents: 1000,
      purchaseTax: { choice: "SELLER_CHARGED", vendorTaxCents: 101 },
    });
    expect(units.map(unit => unit.acquisitionTaxPaidCents)).toEqual([34, 34, 33]);
    expect(units.reduce((sum, unit) => sum + (unit.acquisitionTaxPaidCents ?? 0), 0)).toBe(101);
    const rows = await prisma.purchaseUseTax.findMany({
      where: { sourceType: "APPLIANCE", sourceId: { in: units.map(unit => unit.id) } },
    });
    expect(rows).toHaveLength(3);
    expect(rows.reduce((sum, row) => sum + row.vendorTaxCents, 0)).toBe(101);
    expect(rows.reduce((sum, row) => sum + row.useTaxDueCents, 0)).toBe(49);
  });

  it("missing purchase context leaves an explicit review without blocking intake", async () => {
    const [unit] = await add(1, {
      applianceTypeId: typeId, quantity: 1, acquisitionCostCents: 1000,
      purchaseTax: { choice: "NONE_CHARGED", vendorTaxCents: 0 },
    });
    expect(unit.acquisitionTaxStatus).toBe("UNKNOWN");
    const last = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "Appliance", entityId: unit.id, action: "appliance.acquisition_tax.record" },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(last.newValue)).toContain("PURCHASE_DATE_OR_COST_MISSING");
    expect(await prisma.purchaseUseTax.count({
      where: { sourceType: "APPLIANCE", sourceId: unit.id },
    })).toBe(0);
  });

  it("replays pending-context evidence without changing its revision or audit history", async () => {
    const [unit] = await add(1, {
      applianceTypeId: typeId, quantity: 1, acquisitionCostCents: 1000,
      purchaseTax: { choice: "NONE_CHARGED", vendorTaxCents: 0 },
    });
    const first = await prisma.appliance.findUniqueOrThrow({ where: { id: unit.id } });
    const before = await prisma.auditLog.count({
      where: { entityType: "Appliance", entityId: unit.id, action: "appliance.acquisition_tax.record" },
    });
    const replay = await recordApplianceAcquisitionTax(userId, {
      applianceId: unit.id, expectedRecordedAt: null, choice: "NONE_CHARGED", vendorTaxCents: 0,
    });
    expect(replay.status).toBe("UNKNOWN");
    const after = await prisma.appliance.findUniqueOrThrow({ where: { id: unit.id } });
    expect(after.acquisitionTaxRecordedAt).toEqual(first.acquisitionTaxRecordedAt);
    expect(await prisma.auditLog.count({
      where: { entityType: "Appliance", entityId: unit.id, action: "appliance.acquisition_tax.record" },
    })).toBe(before);
  });

  it("rejects receipt evidence belonging to another appliance without an audit write", async () => {
    const [owner, target] = await add(2);
    const photo = await prisma.photo.create({
      data: { url: "private/acq-" + tag, applianceId: owner.id },
    });
    const before = await prisma.auditLog.count({
      where: { entityType: "Appliance", entityId: target.id },
    });
    await expect(recordApplianceAcquisitionTax(userId, {
      applianceId: target.id, expectedRecordedAt: null,
      choice: "SELLER_CHARGED", vendorTaxCents: 25, receiptPhotoId: photo.id,
    })).rejects.toThrow(/receipt/);
    expect(await prisma.auditLog.count({
      where: { entityType: "Appliance", entityId: target.id },
    })).toBe(before);
    expect((await prisma.appliance.findUniqueOrThrow({
      where: { id: target.id },
    })).acquisitionTaxRecordedAt).toBeNull();
  });

  it("serializes simultaneous edits and rejects the stale revision", async () => {
    const [unit] = await add();
    const edits = await Promise.allSettled([
      recordApplianceAcquisitionTax(userId, {
        applianceId: unit.id, expectedRecordedAt: null,
        choice: "LATER", vendorTaxCents: 0, sellerNote: "Seller A",
      }),
      recordApplianceAcquisitionTax(userId, {
        applianceId: unit.id, expectedRecordedAt: null,
        choice: "LATER", vendorTaxCents: 0, sellerNote: "Seller B",
      }),
    ]);
    expect(edits.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(edits.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await prisma.auditLog.count({
      where: { entityType: "Appliance", entityId: unit.id, action: "appliance.acquisition_tax.record" },
    })).toBe(1);
  });

  it("corrects audited filed purchase evidence without rewriting the filed packet and opens an amendment", async () => {
    const [unit] = await add(1, {
      applianceTypeId: typeId, quantity: 1,
      purchaseDate: day("2026-09-18"), acquisitionCostCents: 10000,
      purchaseTax: { choice: "NONE_CHARGED", vendorTaxCents: 0 },
    });
    const originalTax = await prisma.purchaseUseTax.findFirstOrThrow({
      where: { sourceType: "APPLIANCE", sourceId: unit.id },
    });
    expect(originalTax.useTaxDueCents).toBe(500);
    const period = await prisma.taxFilingPeriod.create({
      data: { filingAccountId: accountId, periodStart: day("2026-09-01"),
        periodEnd: day("2026-09-30"), dueOn: day("2026-10-20") },
    });
    periodIds.push(period.id);
    const packet = await loadFilingPacket(period.id, day("2026-10-22"));
    expect(packet.status).toBe("READY");
    if (packet.status !== "READY") throw new Error(packet.problems.join(" "));
    await markPeriodFiled(userId, {
      periodId: period.id, filedOn: day("2026-10-22"), paidOn: day("2026-10-22"),
      confirmationNumber: "ACQ-TEST-" + tag,
      amountPaidCents: packet.packet.totals.remitIfOnTimeCents,
      amountDifferentReason: "Test evidence if timing affects retained discount",
    });
    const filed = await prisma.taxFilingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(filed.status).toBe("FILED");
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: unit.id } })).acquisitionTaxStatus).toBe("USE_TAX_PAID");
    const updated = await recordApplianceAcquisitionTax(userId, {
      applianceId: unit.id, expectedRecordedAt: unit.acquisitionTaxRecordedAt,
      choice: "SELLER_CHARGED", vendorTaxCents: 200,
      sellerNote: "Corrected vendor receipt",
    });
    expect(updated.status).toBe("SALES_TAX_PAID");
    const correctedTax = await prisma.purchaseUseTax.findFirstOrThrow({
      where: { id: originalTax.id },
    });
    expect(correctedTax.useTaxDueCents).toBe(300);
    expect(correctedTax.status).toBe("FILED");
    expect(correctedTax.filingPeriodId).toBe(period.id);
    expect((await prisma.taxFilingPeriod.findUniqueOrThrow({
      where: { id: period.id },
    })).worksheet).toEqual(filed.worksheet);
    expect(await detectTaxFilingAmendments(day("2026-11-20"))).toBeGreaterThanOrEqual(1);
    const amendment = await prisma.taxFilingAmendment.findFirstOrThrow({
      where: { periodId: period.id, status: "OPEN" },
    });
    expect(amendment.additionalTaxCents).toBeLessThan(0);
  });
});
