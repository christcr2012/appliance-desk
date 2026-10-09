import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/domains/messaging/owner-alerts", () => ({ sendOwnerAlert: vi.fn(async () => {}) }));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async () => ({ user: { id: "test-owner", role: "OWNER" } })),
}));
import { prisma } from "@/lib/prisma";
import { createApplianceUnits } from "@/domains/inventory";
import { recalculatePendingPurchaseTax } from "@/domains/tax/purchase-tax-catch-up";
import { confirmBusinessTaxAddress } from "@/domains/tax/locations";
import { listAcquisitionTaxAttention } from "@/domains/tax/acquisition-attention";
import { businessDateFromKey } from "@/lib/business-date";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname)
  && url.pathname === "/appliance_desk_test";
const tag = randomUUID().replaceAll("-", "").slice(0, 16);
const owner = "w0a-rec-owner-" + tag, type = "w0a-rec-type-" + tag;
const jur = "w0a-rec-jur-" + tag, loc = "w0a-rec-location-" + tag;
const day = (s: string) => businessDateFromKey(s)!;
describe.skipIf(!enabled)("W-0A purchase-tax catch-up (Postgres)", () => {
  const ids: string[] = [];
  let oldLocations: string[] = [];
  let oldElection: "UNDECIDED" | "PAY_ON_ACQUISITION" | "COLLECT_ON_RENTALS";
  let oldBusinessAddress: unknown;
  beforeAll(async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    oldElection = settings.shortTermLeaseElection;
    oldBusinessAddress = settings.businessTaxAddress;
    oldLocations = (await prisma.addressTaxLocation.findMany({
      where: { forBusinessLocation: true, isCurrent: true }, select: { id: true },
    })).map(row => row.id);
    await prisma.addressTaxLocation.updateMany({
      where: { id: { in: oldLocations } }, data: { isCurrent: false },
    });
    await prisma.user.create({ data: {
      id: owner, email: tag + "-w0a@example.test", role: "OWNER",
    } });
    await prisma.applianceType.create({ data: {
      id: type, name: "W0A catchup", slug: "w0a-" + tag, monthlyPriceCents: 1000,
    } });
    await prisma.taxJurisdiction.create({ data: {
      id: jur, code: "W0R-" + tag, name: "Catch-up area",
      level: "CITY", administration: "SELF_COLLECTED", reviewStatus: "REVIEWED",
    } });
    await prisma.taxRateVersion.create({ data: {
      jurisdictionId: jur, rateMilliPercent: 5000,
      effectiveFrom: day("2026-01-01"), source: "MANUAL",
    } });
    await prisma.businessSettings.update({ where: { id: "singleton" },
      data: { shortTermLeaseElection: "PAY_ON_ACQUISITION",
        businessTaxAddress: { line1: "1 Test Ave", city: "Greeley", state: "CO", zip: "80631" },
      } });
    await prisma.addressTaxLocation.create({ data: {
      id: loc, isCurrent: true, forBusinessLocation: true,
      status: "NEEDS_REVIEW", source: "MANUAL", lookedUpAt: day("2026-09-01"),
      jurisdictions: { create: [{ jurisdictionId: jur }] },
    } });
  });
  afterAll(async () => {
    await prisma.purchaseUseTax.deleteMany({ where: { sourceType: "APPLIANCE", sourceId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: owner } });
    await prisma.photo.deleteMany({ where: { applianceId: { in: ids } } });
    await prisma.appliance.deleteMany({ where: { id: { in: ids } } });
    await prisma.applianceType.delete({ where: { id: type } });
    await prisma.addressTaxLocation.deleteMany({ where: { forBusinessLocation: true, confirmedByUserId: owner } });
    await prisma.addressTaxLocation.deleteMany({ where: { id: loc } });
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: oldLocations } },
      data: { isCurrent: true } });
    await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId: jur } });
    await prisma.taxJurisdiction.delete({ where: { id: jur } });
    await prisma.businessSettings.update({ where: { id: "singleton" },
      data: { shortTermLeaseElection: oldElection, businessTaxAddress: oldBusinessAddress as never } });
    await prisma.user.delete({ where: { id: owner } });
  });
  async function addPending() {
    const [unit] = await createApplianceUnits(owner, {
      applianceTypeId: type, quantity: 1, acquisitionCostCents: 10000,
      purchaseTax: { choice: "NONE_CHARGED", vendorTaxCents: 0 },
    });
    ids.push(unit.id);
    await prisma.appliance.update({ where: { id: unit.id },
      data: { purchaseDate: day("2026-09-12") } });
    return unit.id;
  }
  it("confirming the business address triggers catch-up", async () => {
    const id = await addPending();
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id } }))
      .acquisitionTaxStatus).toBe("UNKNOWN");
    const today = await listAcquisitionTaxAttention(day("2026-10-01"));
    expect(today.find(x => x.category === "ACQUISITION_TAX_REVIEW")?.detail)
      .toContain("waiting for your business address to be confirmed");
    await confirmBusinessTaxAddress(owner, { jurisdictionIds: [jur] });
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id } }))
      .acquisitionTaxStatus).toBe("USE_TAX_DUE");
  });
  it("a second pass is idempotent and does not rewrite classified purchases", async () => {
    const countBefore = await prisma.purchaseUseTax.count({
      where: { sourceType: "APPLIANCE", sourceId: { in: ids } },
    });
    const result = await recalculatePendingPurchaseTax(new Date(), 200);
    expect(result.calculated).toBe(0);
    expect(await prisma.purchaseUseTax.count({
      where: { sourceType: "APPLIANCE", sourceId: { in: ids } },
    })).toBe(countBefore);
  });
  it("catch-up does not rewrite a filed purchase row", async () => {
    const id = await addPending();
    const rate = await prisma.taxRateVersion.findFirstOrThrow({
      where: { jurisdictionId: jur },
    });
    const row = await prisma.purchaseUseTax.create({ data: {
      sourceType: "APPLIANCE", sourceId: id, purchasedOn: day("2026-09-12"),
      purchaseAmountCents: 10000, vendorTaxCents: 0, jurisdictionId: jur,
      rateVersionId: rate.id, useTaxDueCents: 123, status: "FILED",
    } });
    const result = await recalculatePendingPurchaseTax(new Date(), 200);
    expect(result.stillPending).toBeGreaterThanOrEqual(1);
    expect((await prisma.purchaseUseTax.findUniqueOrThrow({ where: { id: row.id } }))
      .useTaxDueCents).toBe(123);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id } }))
      .acquisitionTaxStatus).toBe("UNKNOWN");
  });
});
