import { describe, expect, it } from "vitest";
import { effectiveSetupTaxTreatment } from "@/domains/billing/setup-tax-approval";
import { parseSetupTaxOwnerApproval } from "@/domains/billing/setup-tax-owner-approval";

const now = new Date("2026-10-14T17:00:00.000Z");
const proof = {
  treatment: "TAXABLE", note: "CPA explained the mandatory fee is taxable.",
  confirmedOn: "2026-10-12", effectiveFrom: "2026-10-14",
  reference: "Professional memo 2026-10-12, adviser Tax Professional", attested: true,
};
describe("W-22 owner-supported CPA confirmation (does not authorize LIVE money)", () => {
  it("keeps both older free-text selections and missing references blocked", () => {
    const approved = parseSetupTaxOwnerApproval(proof, now);
    expect(effectiveSetupTaxTreatment({ setupFeeTaxTreatment: "TAXABLE",
      ...approved, setupFeeTaxApprovedAt: null }, now)).toBe("UNDECIDED");
    expect(effectiveSetupTaxTreatment({setupFeeTaxTreatment: "NOT_TAXABLE",
      ...approved, setupFeeTaxAdviserReference: null}, now)).toBe("UNDECIDED");
  });
  it("accepts owner attestation with real adviser details and audit-ready dates", () => {
    const approved = parseSetupTaxOwnerApproval(proof, now);
    expect(effectiveSetupTaxTreatment({...approved,setupFeeTaxTreatment: "TAXABLE"}, now)).toBe("TAXABLE");
    expect(approved.setupFeeTaxApprovedAt).toEqual(now);
  });
  it("rejects unconfirmed decisions, fabricated dates, missing references and fake tax choices", () => {
    for (const override of [
      {attested:false}, {reference:"x"}, {note:"x"},
      {confirmedOn:"2026-10-15"}, {confirmedOn:"2026-02-30"},
      {confirmedOn:"2026/10/12"}, {treatment:"UNKNOWN"}
    ]) expect(()=>parseSetupTaxOwnerApproval({...proof,...override},now)).toThrow();
  });
  it("supports future effective policies without prematurely enabling business use", () => {
    const pending = parseSetupTaxOwnerApproval({...proof,effectiveFrom:"2026-11-01"},now);
    expect(effectiveSetupTaxTreatment({...pending,setupFeeTaxTreatment:"TAXABLE"},now)).toBe("UNDECIDED");
    expect(effectiveSetupTaxTreatment({...pending,setupFeeTaxTreatment:"TAXABLE"},new Date("2026-11-02T12:00:00Z"))).toBe("TAXABLE");
  });
  it("reset is a revocation, regardless of stale adviser inputs", () => {
    const revoked = parseSetupTaxOwnerApproval({...proof,treatment:"UNDECIDED"},now);
    expect(revoked.setupFeeTaxApprovedAt).toBeNull();
    expect(effectiveSetupTaxTreatment({...revoked,setupFeeTaxTreatment:"UNDECIDED"},now)).toBe("UNDECIDED");
  });
  it("effective dates and confirmation dates are checked against actual date, not just saved text", () => {
    const approved = parseSetupTaxOwnerApproval(proof,now);
    expect(effectiveSetupTaxTreatment({...approved,setupFeeTaxTreatment:"TAXABLE",setupFeeTaxConfirmedOn:new Date("2026-10-15")},now)).toBe("UNDECIDED");
    expect(effectiveSetupTaxTreatment({...approved,setupFeeTaxTreatment:"TAXABLE"},new Date("invalid"))).toBe("UNDECIDED");
  });
});
