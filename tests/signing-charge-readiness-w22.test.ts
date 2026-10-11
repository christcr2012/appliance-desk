import { describe, expect, it } from "vitest";
import { assessPreparedSigningCharges, type PreparedChargeFact } from "@/domains/billing/signing-charge-readiness";

const version = "a".repeat(64);
function row(overrides: Partial<PreparedChargeFact> = {}): PreparedChargeFact {
  return {
    agreementId: "a", serviceAddressId: "loc1", sourceFingerprint: version,
    machineCount: 1, firstMonthRentCents: 3500, setupFeeCents: 4500,
    downPaymentCents: 0, signingSubtotalCents: 4500,
    setupFeeTaxTreatment: "UNDECIDED", frozenAt: null, ...overrides,
  };
}

describe("W-22C draft readiness never activates collection", () => {
  it("blocks the undecided CPA category even with complete one-location allocations", () => {
    const result = assessPreparedSigningCharges(["a"], [row()]);
    expect(result).toMatchObject({ totalSetupCents: 4500,
      totalDownPaymentCents: 0, totalBeforeTaxCents: 4500, machineCount: 1 });
    expect(result.reasons.join(" ")).toMatch(/undecided.*IN-79/i);
  });

  it.each(["TAXABLE", "NOT_TAXABLE"])("does not treat configured %s as CPA approval", (value) => {
    const result = assessPreparedSigningCharges(["a"], [row({ setupFeeTaxTreatment: value })]);
    expect(result.amountsReconciled).toBe(true);
    expect(result.reasons.join(" ")).toMatch(/CPA approval.*IN-79/);
  });

  it("requires all sibling allocations and matching fingerprints", () => {
    expect(assessPreparedSigningCharges(["a", "b"], [row()]).reasons.join(" ")).toMatch(/complete/);
    const result = assessPreparedSigningCharges(["a", "b"], [row(), row({
      agreementId: "b", serviceAddressId: "loc2", sourceFingerprint: "b".repeat(64),
    })]);
    expect(result.reasons.join(" ")).toMatch(/source revisions/);
  });

  it("counts three separate locations once and preserves each first-month credit", () => {
    const rows = [
      row({ downPaymentCents: 3500, signingSubtotalCents: 8000, setupFeeTaxTreatment: "NOT_TAXABLE" }),
      row({ agreementId: "b", serviceAddressId: "loc2", firstMonthRentCents: 6000,
        downPaymentCents: 6000, signingSubtotalCents: 10500, setupFeeTaxTreatment: "NOT_TAXABLE" }),
      row({ agreementId: "c", serviceAddressId: "loc3", firstMonthRentCents: 9000,
        downPaymentCents: 9000, signingSubtotalCents: 13500, setupFeeTaxTreatment: "NOT_TAXABLE" }),
    ];
    expect(assessPreparedSigningCharges(["a", "b", "c"], rows)).toMatchObject({
      totalSetupCents: 13500, totalDownPaymentCents: 18500,
      totalBeforeTaxCents: 32000, machineCount: 3,
    });
  });

  it("rejects double location fees, invalid amounts, unmatched credits and frozen versions", () => {
    const duplicate = assessPreparedSigningCharges(["a", "b"], [row(), row({ agreementId: "b" })]);
    expect(duplicate.reasons.join(" ")).toMatch(/more than one setup fee/);
    const tampered = assessPreparedSigningCharges(["a"], [row({ downPaymentCents: 100,
      signingSubtotalCents: 4600 })]);
    expect(tampered.reasons.join(" ")).toMatch(/invalid or unreconciled/);
    expect(assessPreparedSigningCharges(["a"], [row({ setupFeeCents: -1 })]).reasons.join(" ")).toMatch(/invalid/);
    expect(assessPreparedSigningCharges(["a"], [row({ frozenAt: new Date() })]).reasons.join(" ")).toMatch(/already been frozen/);
  });

  it("does not enable freezing when there is no setup fee and no tax question", () => {
    const result = assessPreparedSigningCharges(["a"], [row({
      setupFeeCents: 0, signingSubtotalCents: 0, setupFeeTaxTreatment: "NOT_TAXABLE",
    })]);
    expect(result).toMatchObject({ totalBeforeTaxCents: 0 });
    expect(result.reasons.join(" ")).toMatch(/tax-inclusive signed snapshot/);
  });
});
