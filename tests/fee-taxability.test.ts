import { describe, expect, it } from "vitest";
import { computeTax, resolveTaxability, type EngineInput, type EngineJurisdiction } from "@/domains/tax/engine";

// FEETAX-1: the optional-and-separately-stated rule for service lines. The engine may use a
// place's optional-separate answer ONLY when the order's saved choice proves the service
// was done by the business AND the free do-it-myself alternative was shown at ordering.
// Every gap (no record, alternative not shown, answer not recorded) falls back to the
// regular answer — the conservative direction.

const state: EngineJurisdiction = {
  id: "state", code: "CO", name: "Colorado", administration: "STATE_COLLECTED",
  rate: { versionId: "rate-state", rateMilliPercent: 2900 }, rules: {},
};
const greeley: EngineJurisdiction = {
  id: "city", code: "GREELEY", name: "Greeley", administration: "SELF_COLLECTED",
  rate: { versionId: "rate-city", rateMilliPercent: 4110 },
  rules: { DELIVERY: "TAXABLE" },
  optionalSeparatedRules: { DELIVERY: "EXEMPT" },
};
const context: Pick<EngineInput, "election" | "defaultRules" | "leaseTermMonths" | "defaultProvisional" | "defaultOptionalSeparatedRules"> = {
  election: "PAY_ON_ACQUISITION", leaseTermMonths: 12,
  defaultRules: { DELIVERY: "TAXABLE" },
};
const proven = { choice: "BY_BUSINESS" as const, alternativeShown: true };

describe("optional-and-separate service line treatment", () => {
  it("uses the place's separate answer when the order proves the alternative was shown", () => {
    const resolved = resolveTaxability(greeley, "DELIVERY", context, proven);
    expect(resolved.taxability).toBe("EXEMPT");
    expect(resolved.reason).toBe("Optional delivery, shown separately — not taxed by Greeley");
  });

  it("the separate answer governs even when it is the taxed one", () => {
    const fortCollins: EngineJurisdiction = {
      ...greeley, id: "fc", name: "Fort Collins",
      rules: { DELIVERY: "EXEMPT" }, optionalSeparatedRules: { DELIVERY: "TAXABLE" },
    };
    const resolved = resolveTaxability(fortCollins, "DELIVERY", context, proven);
    expect(resolved.taxability).toBe("TAXABLE");
    expect(resolved.reason).toBe("Optional delivery, shown separately — taxed by Fort Collins");
  });

  it("falls back to the regular answer when the alternative was not shown", () => {
    const resolved = resolveTaxability(greeley, "DELIVERY", context,
      { choice: "BY_BUSINESS", alternativeShown: false });
    expect(resolved.taxability).toBe("TAXABLE");
    expect(resolved.reason).toBe("Tax rule configured for Greeley");
  });

  it("treats a missing choice record (old orders) as not optional", () => {
    expect(resolveTaxability(greeley, "DELIVERY", context, null).taxability).toBe("TAXABLE");
    expect(resolveTaxability(greeley, "DELIVERY", context, undefined).taxability).toBe("TAXABLE");
    expect(resolveTaxability(greeley, "DELIVERY", context).taxability).toBe("TAXABLE");
  });

  it("does not apply when the customer did the service themselves", () => {
    const resolved = resolveTaxability(greeley, "DELIVERY", context,
      { choice: "CUSTOMER_DOES_IT", alternativeShown: true });
    expect(resolved.taxability).toBe("TAXABLE");
    expect(resolved.reason).toBe("Tax rule configured for Greeley");
  });

  it("falls back when the place recorded no separate answer", () => {
    const noAnswer: EngineJurisdiction = { ...greeley, optionalSeparatedRules: {} };
    expect(resolveTaxability(noAnswer, "DELIVERY", context, proven).taxability).toBe("TAXABLE");
    const undecided: EngineJurisdiction = { ...greeley, optionalSeparatedRules: { DELIVERY: "UNDECIDED" } };
    expect(resolveTaxability(undecided, "DELIVERY", context, proven).taxability).toBe("TAXABLE");
  });

  it("uses the state-collected default separate answer when the place has none of its own", () => {
    const resolved = resolveTaxability(state, "DELIVERY",
      { ...context, defaultOptionalSeparatedRules: { DELIVERY: "EXEMPT" } }, proven);
    expect(resolved.taxability).toBe("EXEMPT");
    expect(resolved.reason).toBe("Optional delivery, shown separately — not taxed by Colorado");
  });

  it("never applies the separate answer to a non-service category", () => {
    const resolved = resolveTaxability(state, "DAMAGE_WAIVER",
      { ...context, defaultRules: { DAMAGE_WAIVER: "TAXABLE" },
        defaultOptionalSeparatedRules: { DAMAGE_WAIVER: "EXEMPT" } }, proven);
    expect(resolved.taxability).toBe("TAXABLE");
    expect(resolved.reason).toBe("Default state-collected tax rule");
  });

  it("labels the result provisional when the cell is a starting value", () => {
    const provisionalCity: EngineJurisdiction = { ...greeley, provisional: { DELIVERY: true } };
    const resolved = resolveTaxability(provisionalCity, "DELIVERY", context, proven);
    expect(resolved.taxability).toBe("EXEMPT");
    expect(resolved.provisional).toBe(true);
  });

  it("computeTax leaves the proven-optional delivery untaxed in Greeley and taxes it without proof", () => {
    const base: EngineInput = {
      taxDate: new Date("2026-11-02T18:00:00Z"), leaseTermMonths: 12, election: "PAY_ON_ACQUISITION",
      defaultRules: { DELIVERY: "TAXABLE" }, jurisdictions: [greeley], exemptJurisdictionIds: new Set(),
      lines: [{ key: "delivery", kind: "DELIVERY_FEE", amountCents: 7500, serviceChoice: proven }],
    };
    const withProof = computeTax(base);
    expect(withProof.ok).toBe(true);
    if (!withProof.ok) return;
    expect(withProof.totalTaxCents).toBe(0);
    expect(withProof.lines[0]?.exemptCents).toBe(7500);

    const withoutProof = computeTax({
      ...base,
      lines: [{ key: "delivery", kind: "DELIVERY_FEE", amountCents: 7500 }],
    });
    expect(withoutProof.ok).toBe(true);
    if (!withoutProof.ok) return;
    // 4.11% of $75.00 = 308.25 cents of tax before the engine's rounding rules; it must be > 0.
    expect(withoutProof.totalTaxCents).toBeGreaterThan(0);
    expect(withoutProof.lines[0]?.taxableCents).toBe(7500);
  });
});

import { greeleyFeeEmailDraft, GREELEY_SALES_TAX_EMAIL } from "@/domains/tax/greeley-email";

describe("the drafted email to Greeley Sales Tax", () => {
  const draft = greeleyFeeEmailDraft("Robinson Appliance Rentals LLC");
  it("asks the three Greeley questions in plain words", () => {
    expect(draft.to).toBe(GREELEY_SALES_TAX_EMAIL);
    expect(draft.body).toContain("36 months or less");
    expect(draft.body).toContain("optional and listed as their own line");
    expect(draft.body).toContain("damage waiver, a late fee, and our one-time setup fee");
    expect(draft.body).toContain("Robinson Appliance Rentals LLC");
    expect(draft.body.toLowerCase()).not.toContain("election");
  });
  it("opens in the owner's own mail app with subject and body filled in", () => {
    expect(draft.mailto.startsWith(`mailto:${GREELEY_SALES_TAX_EMAIL}?subject=`)).toBe(true);
    expect(draft.mailto).toContain(encodeURIComponent(draft.subject));
    expect(draft.mailto).toContain(encodeURIComponent("36 months or less"));
  });
});
