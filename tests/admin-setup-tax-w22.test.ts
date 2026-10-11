import { describe, expect, it } from "vitest";
import { categorizeLine } from "@/domains/billing/categories";
import { categoryForLineKind } from "@/domains/tax/categories";
import { computeTax, resolveTaxability, type EngineJurisdiction } from "@/domains/tax/engine";

const jurisdiction = (rules: EngineJurisdiction["rules"] = {}, administration: EngineJurisdiction["administration"] = "STATE_COLLECTED") => ({
  id: "co", code: "CO", name: "Colorado", administration,
  rate: { versionId: "co-rate", rateMilliPercent: 7375 }, rules,
});
const input = (rules: EngineJurisdiction["rules"] = {}, defaults: EngineJurisdiction["rules"] = {}) => ({
  taxDate: new Date("2026-10-11T12:00:00Z"), leaseTermMonths: 12,
  election: "COLLECT_ON_RENTALS" as const,
  defaultRules: defaults, exemptJurisdictionIds: new Set<string>(),
  jurisdictions: [jurisdiction(rules)],
  lines: [{ key: "setup", kind: "ADMIN_SETUP_FEE" as const, amountCents: 4500 }],
});

describe("W-22C1 administrative setup tax isolation", () => {
  it("maps the new mandatory setup line independently of delivery and installation", () => {
    expect(categoryForLineKind("ADMIN_SETUP_FEE", 4500)).toBe("ADMINISTRATIVE_SETUP");
    expect(categoryForLineKind("INSTALLATION_FEE", 4500)).toBe("INSTALLATION");
    expect(categoryForLineKind("RENTAL", 4500)).toBe("RENTAL");
    expect(categorizeLine("ADMIN_SETUP_FEE")).toBe("FEES");
  });
  it("does not inherit rental election, unrelated default or installation policy", () => {
    expect(computeTax(input({ RENTAL: "TAXABLE", INSTALLATION: "EXEMPT" }, { RENTAL: "TAXABLE" }))).toMatchObject({ ok: false });
    const result = resolveTaxability(jurisdiction({ RENTAL: "TAXABLE" }), "ADMINISTRATIVE_SETUP", {
      election: "COLLECT_ON_RENTALS", leaseTermMonths: 12, defaultRules: { RENTAL: "TAXABLE" },
    });
    expect(result.taxability).toBe("UNDECIDED");
  });
  it("requires a specific approved home-rule classification, not state defaults", () => {
    const result = resolveTaxability(jurisdiction({}, "SELF_COLLECTED"), "ADMINISTRATIVE_SETUP", {
      election: "COLLECT_ON_RENTALS", leaseTermMonths: 12,
      defaultRules: { ADMINISTRATIVE_SETUP: "EXEMPT" },
    });
    expect(result.taxability).toBe("UNDECIDED");
  });
  it("taxes only with explicitly decided category and exact three-digit rate", () => {
    expect(computeTax(input({}, { ADMINISTRATIVE_SETUP: "TAXABLE" }))).toMatchObject({
      ok: true, totalTaxCents: 332,
    });
    expect(computeTax(input({ ADMINISTRATIVE_SETUP: "EXEMPT" }))).toMatchObject({
      ok: true, totalTaxCents: 0,
    });
  });
  it("rejects missing rates for a taxable setup fee and never silently bills", () => {
    const fixture = input({ ADMINISTRATIVE_SETUP: "TAXABLE" });
    expect(computeTax({ ...fixture, jurisdictions: [{ ...fixture.jurisdictions[0], rate: null }] })).toMatchObject({ ok: false });
  });
});
