import { describe, expect, it } from "vitest";
import { previewEstimateAllInCharges, type EstimatePreviewInput } from "@/domains/estimates/all-in-preview";

function fixture(): EstimatePreviewInput {
  return {
    lines: [
      { id: "washer", serviceAddressId: "unit-a", addressLabel: "100 Main, Greeley",
        quantity: 1, monthlyPriceCents: 3500, oneTimeFeeCents: 2000, machineCountPerUnit: 1 },
      { id: "dryer", serviceAddressId: "unit-a", addressLabel: "100 Main, Greeley",
        quantity: 1, monthlyPriceCents: 3500, oneTimeFeeCents: 0, machineCountPerUnit: 1 },
      { id: "set", serviceAddressId: "unit-b", addressLabel: "200 Main, Greeley",
        quantity: 2, monthlyPriceCents: 6000, oneTimeFeeCents: 1000, machineCountPerUnit: 2 },
    ],
    depositCents: 5000,
    settings: {
      setupFeeCents: 4500, largeOrderMachineThreshold: 5,
      businessRequiresDownPayment: true, setupFeeTaxTreatment: "UNDECIDED",
      deliveryFeeCents: 1200, installationFeeCents: 0, removalFeeCents: 0,
      damageWaiverEnabled: false, depositEnabled: true,
    },
    existingActiveAddressIds: [],
    businessCustomer: false, propertyManagerCustomer: false,
  };
}
describe("owner-only W-22FIN all-in estimate preparation", () => {
  it("groups complete real package counts, setup fees once per address, advance payments and deposit separately", () => {
    const p = previewEstimateAllInCharges(fixture());
    expect(p.locations).toHaveLength(2);
    expect(p.locations[0]).toMatchObject({ serviceAddressId: "unit-a",
      machines: 2, setupFeeCents: 4500, firstMonthDownPaymentCents: 7000,
      monthlyRentCents: 7000, quotedOneTimeCents: 2000 });
    expect(p.locations[1]).toMatchObject({ serviceAddressId: "unit-b",
      machines: 4, setupFeeCents: 4500, firstMonthDownPaymentCents: 12000 });
    expect(p.known).toMatchObject({
      monthlyRentCents: 19000, quotedOneTimeCents: 4000,
      setupFeeCents: 9000, firstMonthDownPaymentCents: 19000,
      requestedDepositCents: 5000, knownSubtotalCents: 37000,
    });
    expect(p.eligibleForCustomerApproval).toBe(false);
    expect(p.eligibleForBindingSend).toBe(false);
    expect(p.eligibleForDepositCheckout).toBe(false);
    expect(p.missingCategories).toContain("location-specific setup sales tax");
  });

  it("does not charge a duplicate setup fee on an already active address", () => {
    const p = previewEstimateAllInCharges({
      ...fixture(), existingActiveAddressIds: ["unit-a"],
    });
    expect(p.locations[0].setupFeeCents).toBe(0);
    expect(p.locations[1].setupFeeCents).toBe(4500);
    expect(p.known?.setupFeeCents).toBe(4500);
  });

  it("never mistakes owner-declared reviewed tax treatment for completed local jurisdiction evidence", () => {
    const p = previewEstimateAllInCharges({
      ...fixture(), settings: { ...fixture().settings, setupFeeTaxTreatment: "NOT_TAXABLE" },
    });
    expect(p.status).toBe("REVIEW_REQUIRED");
    expect(p.reasons).toContain("Location-specific setup tax rates and jurisdiction evidence are not frozen.");
    expect(p.eligibleForCustomerApproval).toBe(false);
  });

  it("rejects unassigned locations instead of distributing setup or monthly rent arbitrarily", () => {
    const f = fixture();
    const p = previewEstimateAllInCharges({
      ...f, lines: [...f.lines, { ...f.lines[0], id: "unknown", serviceAddressId: null }],
    });
    expect(p.unassignedLineCount).toBe(1);
    expect(p.known).toBeNull();
    expect(p.reasons).toEqual(expect.arrayContaining([expect.stringContaining("delivery location")]));
  });

  it("does not infer a washer/dryer count from a description or line item without a real package", () => {
    const f = fixture();
    const p = previewEstimateAllInCharges({
      ...f, lines: [{ ...f.lines[0], machineCountPerUnit: null }],
    });
    expect(p.known).toBeNull();
    expect(p.locations).toEqual([]);
    expect(p.reasons.join(" ")).toMatch(/machine count/i);
  });

  it("fails closed on unsafe integer, negative cents, quantity zero and overflowing totals", () => {
    const f = fixture();
    for (const item of [
      { quantity: 0 }, { quantity: -1 }, { monthlyPriceCents: -200 },
      { quantity: 1e10 }, { monthlyPriceCents: Number.MAX_SAFE_INTEGER },
      { oneTimeFeeCents: Number.NaN },
    ]) {
      const p = previewEstimateAllInCharges({
        ...f, lines: [{ ...f.lines[0], ...item }],
      });
      expect(p.known).toBeNull();
      expect(p.eligibleForCustomerApproval).toBe(false);
    }
  });

  it("marks every unverified fee category explicitly instead of claiming an all-in total", () => {
    const f = fixture();
    const p = previewEstimateAllInCharges({
      ...f, settings: { ...f.settings, damageWaiverEnabled: true, depositEnabled: true },
      applicability: {
        delivery: "REQUIRED", installation: "NOT_APPLICABLE", removal: "NOT_APPLICABLE",
        damageWaiver: "REQUIRED", retailDelivery: "REQUIRED",
      },
    });
    expect(p.missingCategories).toEqual(expect.arrayContaining([
      "delivery fee allocation", "damage waiver", "retail delivery fee rate",
      "effective-dated rental tax and exemption review",
    ]));
    expect(p.known?.knownSubtotalCents).toBeDefined();
    expect(p.status).toBe("REVIEW_REQUIRED");
  });

  it("customer type and large order machine threshold consistently affect first month advance", () => {
    const f = fixture();
    const lines = [f.lines[0]];
    expect(previewEstimateAllInCharges({ ...f, lines }).locations[0].firstMonthDownPaymentCents).toBe(0);
    expect(previewEstimateAllInCharges({ ...f, lines, businessCustomer: true })
      .locations[0].firstMonthDownPaymentCents).toBe(3500);
    expect(previewEstimateAllInCharges({
      ...f, lines, propertyManagerCustomer: true,
    }).locations[0].firstMonthDownPaymentCents).toBe(3500);
  });

  it("unverified nonzero deposits cannot be silently labeled collected", () => {
    const p = previewEstimateAllInCharges(fixture());
    expect(p.known?.requestedDepositCents).toBe(5000);
    expect(JSON.stringify(p)).not.toMatch(/paidAt|settled|received/i);
    expect(p.eligibleForDepositCheckout).toBe(false);
  });
});
