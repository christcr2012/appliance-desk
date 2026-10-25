import { describe, expect, it } from "vitest";
import { computeTax, type EngineInput, type EngineJurisdiction } from "@/domains/tax/engine";

const state: EngineJurisdiction = {
  id: "state", code: "CO", name: "Colorado", administration: "STATE_COLLECTED",
  rate: { versionId: "rate-state", rateMilliPercent: 2900 }, rules: {},
};
const city: EngineJurisdiction = {
  id: "city", code: "GREELEY", name: "Greeley", administration: "SELF_COLLECTED",
  rate: { versionId: "rate-city", rateMilliPercent: 4110 }, rules: { DELIVERY: "TAXABLE" },
};
function input(overrides: Partial<EngineInput>): EngineInput {
  return {
    taxDate: new Date("2026-11-02T18:00:00Z"), leaseTermMonths: 12, election: "PAY_ON_ACQUISITION",
    defaultRules: { DELIVERY: "TAXABLE" }, jurisdictions: [state, city], exemptJurisdictionIds: new Set(),
    lines: [{ key: "delivery", kind: "DELIVERY_FEE", amountCents: 7500 }],
    ...overrides,
  };
}

describe("provisional (not yet confirmed) taxability starting values", () => {
  it("calculate exactly like confirmed values", () => {
    const confirmed = computeTax(input({}));
    const provisional = computeTax(input({
      defaultProvisional: { DELIVERY: true },
      jurisdictions: [state, { ...city, provisional: { DELIVERY: true } }],
    }));
    expect(confirmed.ok && provisional.ok).toBe(true);
    if (!confirmed.ok || !provisional.ok) return;
    expect(provisional.totalTaxCents).toBe(confirmed.totalTaxCents);
    expect(provisional.lines.map((line) => line.taxCents)).toEqual(confirmed.lines.map((line) => line.taxCents));
  });

  it("are labelled 'not confirmed' on the result and on each line that used one", () => {
    const confirmed = computeTax(input({}));
    expect(confirmed).toMatchObject({ ok: true });
    expect("provisional" in confirmed).toBe(false);
    const onlyCity = computeTax(input({ jurisdictions: [state, { ...city, provisional: { DELIVERY: true } }] }));
    expect(onlyCity.ok).toBe(true);
    if (!onlyCity.ok) return;
    expect(onlyCity.provisional).toBe(true);
    expect(onlyCity.lines.find((line) => line.jurisdictionId === "city")?.provisional).toBe(true);
    expect(onlyCity.lines.find((line) => line.jurisdictionId === "state")?.provisional).toBeUndefined();
    const exempt = computeTax(input({ defaultRules: { DELIVERY: "EXEMPT" }, defaultProvisional: { DELIVERY: true },
      jurisdictions: [state] }));
    expect(exempt).toMatchObject({ ok: true, totalTaxCents: 0, provisional: true });
  });

  it("an undecided rule still stops the bill, provisional or not", () => {
    const result = computeTax(input({
      defaultRules: { DELIVERY: "UNDECIDED" }, defaultProvisional: { DELIVERY: true }, jurisdictions: [state],
    }));
    expect(result.ok).toBe(false);
  });
});
