import { describe, expect, it } from "vitest";
import { reviewSigningFeeTax, type SigningFeeTaxInput } from "@/domains/billing/signing-charge-tax-evidence";

const date = new Date("2026-10-11T12:00:00.000Z");
const confirmed = new Date("2026-10-10T12:00:00.000Z");
function fixture(overrides: Partial<SigningFeeTaxInput> = {}): SigningFeeTaxInput {
  return {
    setupFeeCents: 4500, downPaymentCents: 3500, setupFeeTaxTreatment: "TAXABLE",
    rules: [{ jurisdictionId: null, taxability: "TAXABLE", cpaConfirmedOn: confirmed }],
    context: {
      taxDate: date, leaseTermMonths: 12, election: "COLLECT_ON_RENTALS",
      defaultRules: { ADMINISTRATIVE_SETUP: "TAXABLE" },
      exemptJurisdictionIds: new Set<string>(),
      jurisdictions: [{ id: "co", code: "CO", name: "Colorado", administration: "STATE_COLLECTED",
        rate: { versionId: "rate-co", rateMilliPercent: 7375 }, rules: {} }],
    },
    ...overrides,
  };
}

describe("W-22C2 candidate setup-tax evidence (no collection)", () => {
  it("uses separately CPA-confirmed rules and exact 7.375 percent tax on setup only", () => {
    const output = reviewSigningFeeTax(fixture());
    expect(output).toMatchObject({ status: "CALCULATED_DRAFT", setupTaxCents: 332,
      candidateSigningTotalCents: 8332, eligibleForCollection: false });
    expect(output.jurisdictionLines).toEqual([expect.objectContaining({
      category: "ADMINISTRATIVE_SETUP", taxableCents: 4500, taxCents: 332,
    })]);
  });
  it("requires independent CPA proof even when settings say taxable", () => {
    const output = reviewSigningFeeTax(fixture({ rules: [] }));
    expect(output.status).toBe("REVIEW_REQUIRED");
    expect(output.candidateSigningTotalCents).toBeNull();
  });
  it("rejects undecided, future-dated and mismatched rule evidence", () => {
    expect(reviewSigningFeeTax(fixture({ setupFeeTaxTreatment: "UNDECIDED" })).status).toBe("REVIEW_REQUIRED");
    expect(reviewSigningFeeTax(fixture({ rules: [{ jurisdictionId: null, taxability: "TAXABLE",
      cpaConfirmedOn: new Date("2026-10-12T00:00:00.000Z") }] })).status).toBe("REVIEW_REQUIRED");
    expect(reviewSigningFeeTax(fixture({ rules: [{ jurisdictionId: null, taxability: "EXEMPT",
      cpaConfirmedOn: confirmed }] })).status).toBe("REVIEW_REQUIRED");
  });
  it("requires a specific home-rule rule even when a state default exists", () => {
    const f = fixture();
    f.context.jurisdictions[0].administration = "SELF_COLLECTED";
    expect(reviewSigningFeeTax(f).status).toBe("REVIEW_REQUIRED");
  });
  it("returns 0 setup tax for independently confirmed exemption", () => {
    const f = fixture({ setupFeeTaxTreatment: "NOT_TAXABLE",
      rules: [{ jurisdictionId: null, taxability: "EXEMPT", cpaConfirmedOn: confirmed }] });
    f.context.defaultRules.ADMINISTRATIVE_SETUP = "EXEMPT";
    expect(reviewSigningFeeTax(f)).toMatchObject({ status: "CALCULATED_DRAFT", setupTaxCents: 0,
      candidateSigningTotalCents: 8000, eligibleForCollection: false });
  });
  it("fails closed on missing rate, duplicate jurisdiction or invalid cents", () => {
    const f = fixture();
    f.context.jurisdictions[0].rate = null;
    expect(reviewSigningFeeTax(f).status).toBe("REVIEW_REQUIRED");
    f.context.jurisdictions[0].rate = { versionId: "rate-co", rateMilliPercent: 7375 };
    f.context.jurisdictions.push({ ...f.context.jurisdictions[0] });
    expect(reviewSigningFeeTax(f).status).toBe("REVIEW_REQUIRED");
    expect(reviewSigningFeeTax(fixture({ downPaymentCents: -1 })).status).toBe("REVIEW_REQUIRED");
  });
  it("never treats a zero-setup draft as permission to charge", () => {
    expect(reviewSigningFeeTax(fixture({ setupFeeCents: 0, rules: [] }))).toMatchObject({
      status: "CALCULATED_DRAFT", candidateSigningTotalCents: 3500,
      eligibleForCollection: false,
    });
  });
});
