import { describe, expect, it } from "vitest";
import { verifyPreparedEstimateScope } from "@/domains/estimates/preapproval-agreements";
import {
  assessEstimateQuoteCategories, verifyQuotedPackageLines,
} from "@/domains/estimates/preapproval-quote";

const row = (serviceAddressId: string) => ({
  id: "agreement-" + serviceAddressId, customerId: "customer-a", sourceEstimateId: "estimate-a",
  serviceAddressId, status: "DRAFT",
});
describe("W-22FIN preapproval preparation and exact frozen quote policy", () => {
  it("requires exact complete customer, estimate and address scope before aggregating money", () => {
    expect(verifyPreparedEstimateScope([row("a"), row("b")], ["a", "b"],
      "estimate-a", "customer-a")).toEqual(["agreement-a", "agreement-b"]);
    for (const sample of [
      [row("a")],
      [row("a"), { ...row("a"), id: "duplicate" }],
      [row("a"), { ...row("b"), customerId: "foreign" }],
      [row("a"), { ...row("b"), sourceEstimateId: "different" }],
      [row("a"), { ...row("b"), status: "ACTIVE" }],
    ]) {
      expect(() => verifyPreparedEstimateScope(sample, ["a", "b"],
        "estimate-a", "customer-a")).toThrow(/prepared agreements|original customer/i);
    }
  });
  it("expands quoted package quantities to exact owned prepared rentals and prices", () => {
    const estimated = [
      { id: "line-a", serviceAddressId: "a", packageId: "set", quantity: 2,
        monthlyPriceCents: 6000, oneTimeFeeCents: 0 },
      { id: "line-b", serviceAddressId: "b", packageId: "washer", quantity: 1,
        monthlyPriceCents: 3500, oneTimeFeeCents: 0 },
    ];
    const actual = [
      { serviceAddressId: "a", packageId: "set", monthlyPriceCents: 6000 },
      { serviceAddressId: "a", packageId: "set", monthlyPriceCents: 6000 },
      { serviceAddressId: "b", packageId: "washer", monthlyPriceCents: 3500 },
    ];
    expect(verifyQuotedPackageLines({ estimated, actual })).toEqual([]);
    expect(verifyQuotedPackageLines({ estimated, actual: actual.slice(1) }))
      .toEqual(expect.arrayContaining([expect.stringMatching(/differ/i)]));
    expect(verifyQuotedPackageLines({
      estimated, actual: actual.map(row => row.serviceAddressId === "b"
        ? { ...row, monthlyPriceCents: 3000 } : row),
    })).toEqual(expect.arrayContaining([expect.stringMatching(/differ/i)]));
    expect(verifyQuotedPackageLines({
      estimated: [{ ...estimated[0], packageId: null }], actual,
    })).toEqual(expect.arrayContaining([expect.stringMatching(/real package/i)]));
  });
  const policy = {
    decision: { delivery: "NOT_APPLICABLE" as const,
      installation: "NOT_APPLICABLE" as const,
      removal: "NOT_APPLICABLE" as const, damageWaiver: "NOT_APPLICABLE" as const,
      retailDelivery: "EXEMPT" as const },
    revision: 2, reason: "Dated owner-reviewed initial policy.",
  };
  const check = (overrides: Partial<Parameters<typeof assessEstimateQuoteCategories>[0]> = {}) =>
    assessEstimateQuoteCategories({
      depositCents: 0, hasUnclassifiedOneTimeFees: false, setupFeeCents: 4500,
      mandatory: policy, damageWaiverEnabled: false, depositEnabled: false,
      configuredFees: [0, 0, 0], ...overrides,
    });
  it("allows technical exact-source quote candidate only when all mandatory categories are classified and covered", () => {
    expect(check()).toEqual([]);
  });
  it("rejects deposits, unclassified one-time fees and unsupported required charge allocations", () => {
    expect(check({ depositCents: 1000 }).join(" ")).toMatch(/deposit/i);
    expect(check({ hasUnclassifiedOneTimeFees: true }).join(" ")).toMatch(/uncategorized/i);
    expect(check({ configuredFees: [100, 0, 0] }).join(" ")).toMatch(/visit fees/i);
    expect(check({ damageWaiverEnabled: true }).join(" ")).toMatch(/damage waiver/i);
    expect(check({ depositEnabled: true }).join(" ")).toMatch(/deposit/i);
  });
  it("never mistakes an undecided policy or assumed retail delivery rate for a reviewed total", () => {
    const incomplete = { ...policy, revision: null, decision: {
      ...policy.decision, retailDelivery: "UNDECIDED" as const,
      installation: "REQUIRED" as const,
    } };
    const messages = check({ mandatory: incomplete }).join(" ");
    expect(messages).toMatch(/dated owner policy|effective/i);
    expect(messages).toMatch(/installation/i);
    expect(messages).toMatch(/retail delivery/i);
  });
});
