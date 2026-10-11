import { describe, expect, it } from "vitest";
import { buildSigningChargePlan, DEFAULT_SIGNING_CHARGE_SETTINGS, type SigningChargeInput } from "@/domains/billing/signing-charges";
const settings = { ...DEFAULT_SIGNING_CHARGE_SETTINGS, setupFeeTaxTreatment: "NOT_TAXABLE" as const };
function input(counts: number[], options: Partial<SigningChargeInput> = {}): SigningChargeInput {
  return { settings, businessCustomer: false, propertyManagerCustomer: false,
    paidInFullInAdvance: false,
    locations: counts.map((count, index) => ({
      serviceAddressId: "location-" + index,
      machineCount: count, firstMonthRentCents: count * 3500,
      newRentalAtLocation: true, existingActiveRental: false, deliveryRequired: true,
    })), ...options };
}
describe("W-22A location-based signing charges", () => {
  it("charges one $45 setup fee for one appliance or two sets at the same address", () => {
    expect(buildSigningChargePlan(input([1])).setupTotalCents).toBe(4500);
    expect(buildSigningChargePlan(input([4])).setupTotalCents).toBe(4500);
  });
  it("charges $135 on three separately delivered locations", () => {
    expect(buildSigningChargePlan(input([1,1,1])).setupTotalCents).toBe(13500);
  });
  it("requires first rent at five machines and allocates to each site", () => {
    expect(buildSigningChargePlan(input([4])).downPaymentTotalCents).toBe(0);
    const plan = buildSigningChargePlan(input([2,3]));
    expect(plan.downPaymentTotalCents).toBe(17500);
    expect(plan.locations.map((x) => x.downPaymentCents)).toEqual([7000,10500]);
  });
  it("requires first month for business and property managers even at one machine", () => {
    expect(buildSigningChargePlan(input([1], { businessCustomer: true })).downPaymentTotalCents).toBe(3500);
    expect(buildSigningChargePlan(input([1], { propertyManagerCustomer: true })).downPaymentTotalCents).toBe(3500);
    expect(buildSigningChargePlan(input([1], { businessCustomer: true, paidInFullInAdvance: true })).downPaymentTotalCents).toBe(0);
  });
  it("does not automatically charge existing rentals, repairs, or swaps", () => {
    const original = input([2]);
    const location = original.locations[0]!;
    expect(buildSigningChargePlan({ ...original, locations: [{...location, existingActiveRental: true}] }).setupTotalCents).toBe(0);
    expect(buildSigningChargePlan({ ...original, locations: [{...location, newRentalAtLocation: false}] }).setupTotalCents).toBe(0);
    expect(buildSigningChargePlan({ ...original, locations: [{...location, deliveryRequired: false}] }).setupTotalCents).toBe(0);
  });
  it("allows an explained adjustment or waiver but never a silent override", () => {
    const original = input([1]);
    const location = original.locations[0]!;
    expect(() => buildSigningChargePlan({ ...original, locations: [{...location, setupFeeOverrideCents: 0}] })).toThrow(/reason/i);
    const waived = buildSigningChargePlan({ ...original, locations: [{...location, setupFeeOverrideCents: 0, setupFeeOverrideReason: "Owner approved welcome offer"}] });
    expect(waived.amountDueAtSigningCents).toBe(0);
    expect(waived.locations[0]?.feeOverrideReason).toMatch(/welcome/);
  });
  it("fails closed when tax treatment is undecided", () => {
    expect(buildSigningChargePlan(input([1], { settings: DEFAULT_SIGNING_CHARGE_SETTINGS })).requiresTaxReview).toBe(true);
  });
  it("rejects invalid settings, duplicate addresses, and non-integer money", () => {
    expect(() => buildSigningChargePlan(input([1,1], { locations: [input([1]).locations[0]!, input([1]).locations[0]!] }))).toThrow(/address/i);
    expect(() => buildSigningChargePlan(input([1], { settings: {...settings, setupFeeCents: -1} }))).toThrow();
    expect(() => buildSigningChargePlan(input([1], { locations: [{...input([1]).locations[0]!, firstMonthRentCents: 34.5}] }))).toThrow();
  });
});
