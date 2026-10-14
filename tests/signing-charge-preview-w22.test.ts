import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  agreements: { findUnique: vi.fn(), findMany: vi.fn() },
  customer: { findUniqueOrThrow: vi.fn() },
  settings: { findUnique: vi.fn() },
  overrides: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  rentalAgreement: db.agreements, customer: db.customer, businessSettings: db.settings,
  signingSetupFeeOverride: db.overrides,
} }));
vi.mock("@/domains/billing/setup-tax-policy-version", () => ({ getEffectiveSetupTaxTreatment: vi.fn(async () => "UNDECIDED") }));
import { calculateDraftSigningPreview, getDraftSigningChargePreview, type DraftSigningAgreement } from "@/domains/billing/signing-charge-preview";
import { DEFAULT_SIGNING_CHARGE_SETTINGS } from "@/domains/billing/signing-charges";

function agreement(id: string, address: string, cents: number, machines = 1): DraftSigningAgreement {
  return { id, serviceAddressId: address, status: "DRAFT", paidInFullInAdvance: false,
    lines: [{ monthlyPriceCents: cents, package: machines > 1 ? { components: [{ quantity: machines }] } : null }] };
}
const preview = (agreements: DraftSigningAgreement[], overrides: Partial<Parameters<typeof calculateDraftSigningPreview>[0]> = {}) =>
  calculateDraftSigningPreview({ agreements, existingActiveAddressIds: [], businessCustomer: false,
    propertyManagerCustomer: false, settings: DEFAULT_SIGNING_CHARGE_SETTINGS, ...overrides });

describe("W-22 signing-charge stored-draft preview", () => {
  it("keeps one owner-reasoned waiver per location while preserving down payment", () => {
    const result = preview([agreement("a", "unit-a", 6000, 2), agreement("b", "unit-b", 3500)], {
      businessCustomer: true,
      feeOverrides: [{ serviceAddressId: "unit-a", setupFeeCents: 0,
        reason: "Owner approved a multi-unit setup waiver" }],
    });
    expect(result).toMatchObject({ setupTotalCents: 4500, downPaymentTotalCents: 9500 });
    expect(result.locations.find(row => row.serviceAddressId === "unit-a")).toMatchObject({
      setupFeeCents: 0, feeOverrideReason: "Owner approved a multi-unit setup waiver",
    });
  });
  it("retains stored owner override identity even when price later matches the default", () => {
    const result = preview([agreement("a", "home", 6000)], { feeOverrides: [
      { serviceAddressId: "home", setupFeeCents: 4500, reason: "Owner-approved exception retained for audit" },
    ] });
    expect(result.locations).toHaveLength(1);
    expect(result.locations[0].setupFeeCents).toBe(4500);
    expect(result.locations[0].feeOverrideReason).toBe("Owner-approved exception retained for audit");
  });
  it("rejects duplicated overrides, unknown locations and missing reasons", () => {
    const agreements = [agreement("a", "home", 5000)];
    expect(() => preview(agreements, { feeOverrides: [
      { serviceAddressId: "home", setupFeeCents: 0, reason: "owner waiver" },
      { serviceAddressId: "home", setupFeeCents: 0, reason: "other reason" },
    ] })).toThrow(/Duplicate/);
    expect(() => preview(agreements, { feeOverrides: [
      { serviceAddressId: "absent", setupFeeCents: 0, reason: "no address" },
    ] })).toThrow(/no order location/);
    expect(() => preview(agreements, { feeOverrides: [
      { serviceAddressId: "home", setupFeeCents: 0, reason: "" },
    ] })).toThrow(/reason/);
  });
  it("quotes one fee at an address, even with two distinct rental agreements", () => {
    const result = preview([agreement("a", "home", 3500), agreement("b", "home", 6000, 2)]);
    expect(result).toMatchObject({ machineCount: 3, setupTotalCents: 4500, downPaymentTotalCents: 0,
      amountDueAtSigningCents: 4500, requiresTaxReview: true });
    expect(result.locations).toHaveLength(1);
  });
  it("counts every package machine across delivery locations for the bulk threshold", () => {
    const result = preview([agreement("a", "unit1", 6000, 2), agreement("b", "unit2", 6000, 2),
      agreement("c", "unit3", 3500)]);
    expect(result.machineCount).toBe(5);
    expect(result).toMatchObject({ setupTotalCents: 13500, downPaymentTotalCents: 15500,
      amountDueAtSigningCents: 29000 });
  });
  it("handles business trigger, prepaid agreements, and a real active address exemption", () => {
    const prepaid = { ...agreement("a", "old", 6000, 2), paidInFullInAdvance: true };
    const result = preview([prepaid, agreement("b", "new", 3500)], {
      existingActiveAddressIds: ["old"], businessCustomer: true });
    expect(result).toMatchObject({ setupTotalCents: 4500, downPaymentTotalCents: 3500 });
  });
  it("never treats customer data or malformed money as a valid preview", () => {
    expect(() => preview([agreement("x", "home", 100), { ...agreement("y", "new", 100), status: "ACTIVE" }])).toThrow(/draft/);
    expect(() => preview([agreement("x", "home", -1)])).toThrow(/nonnegative/);
    expect(() => preview([agreement("x", "home", 100, 2.5)])).toThrow(/machine count/);
    expect(() => preview([{ ...agreement("x", "home", 100), lines: [] }])).toThrow(/rental item/);
  });
});

describe("W-22B0 private read boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.overrides.findMany.mockResolvedValue([]);
  });
  it("does not read customer financial records for a non-draft agreement", async () => {
    db.agreements.findUnique.mockResolvedValue({ id: "signed", status: "ACTIVE", customerId: "c", sourceEstimateId: null });
    expect(await getDraftSigningChargePreview("signed")).toBeNull();
    expect(db.agreements.findMany).not.toHaveBeenCalled();
    expect(db.customer.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("scopes converted siblings by customer and estimate, and counts persisted packages", async () => {
    db.agreements.findUnique.mockResolvedValue({ id: "a", status: "DRAFT", customerId: "customer-a", sourceEstimateId: "quote-1" });
    db.agreements.findMany
      .mockResolvedValueOnce([
        agreement("a", "unit-a", 6000, 2),
        agreement("b", "unit-b", 3500),
      ])
      .mockResolvedValueOnce([{ serviceAddressId: "unit-a" }]);
    db.customer.findUniqueOrThrow.mockResolvedValue({ isBusiness: true, isPropertyManager: false });
    db.settings.findUnique.mockResolvedValue(null);
    const result = await getDraftSigningChargePreview("a");
    expect(db.agreements.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { customerId: "customer-a", sourceEstimateId: "quote-1" },
    }));
    expect(db.agreements.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { serviceAddressId: { in: ["unit-a", "unit-b"] }, status: "ACTIVE" },
    }));
    expect(result).toMatchObject({ machineCount: 3, setupTotalCents: 4500, downPaymentTotalCents: 9500 });
    expect(db.customer.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "customer-a" },
    }));
  });
  it("never supplies partial signing figures if a converted sibling has already left draft", async () => {
    db.agreements.findUnique.mockResolvedValue({ id: "a", status: "DRAFT", customerId: "customer-a", sourceEstimateId: "quote-1" });
    db.agreements.findMany.mockResolvedValue([
      agreement("a", "unit-a", 3500),
      { ...agreement("b", "unit-b", 3500), status: "AWAITING_SIGNATURE" },
    ]);
    expect(await getDraftSigningChargePreview("a")).toBeNull();
    expect(db.customer.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
