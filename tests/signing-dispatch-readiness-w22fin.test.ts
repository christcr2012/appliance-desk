import { describe, expect, it } from "vitest";
import { signingDispatchDecision, type SigningDispatchEvidence } from "@/domains/billing/signing-dispatch-readiness";
const signedAt = new Date("2026-10-14T13:00:00Z");
const fingerprint = "b".repeat(64);
const receipt = { customerId: "customer-a", amountCents: 4800, receivedOn: signedAt };
function evidence(): SigningDispatchEvidence {
  return {
    customerId: "customer-a", agreementStatus: "ACTIVE",
    hasSigningCharge: true, frozenOrderFingerprint: fingerprint,
    signature: {
      signedAt, signingOrderFingerprint: fingerprint,
      signingAllInCents: 4800, signingEvidenceVersion: 1,
    },
    payment: {
      setupFeeCents: 4500, setupTaxCents: 300, downPaymentCents: 0,
      totalCents: 4800, status: "AWAITING_PAYMENT",
      signedAt, orderFingerprint: fingerprint, evidenceVersion: 1, receipt: null,
    },
  };
}
describe("W-22FIN dispatch requires real final signing evidence", () => {
  it("preserves legacy deliveries that have no W-22 preparation", () => {
    expect(signingDispatchDecision({
      ...evidence(), hasSigningCharge: false,
      frozenOrderFingerprint: null, signature: null, payment: null,
    })).toEqual({ allowed: true, legacy: true });
  });
  it("rejects missing, unsigned, cancelled or unfrozen W-22 proof", () => {
    const e=evidence();
    expect(signingDispatchDecision({ ...e, payment: null }).allowed).toBe(false);
    expect(signingDispatchDecision({ ...e, signature: null }).allowed).toBe(false);
    expect(signingDispatchDecision({ ...e, agreementStatus: "CANCELLED" }).allowed).toBe(false);
    expect(signingDispatchDecision({ ...e, frozenOrderFingerprint: null }).allowed).toBe(false);
  });
  it("does not treat an attempted card payment, foreign or partial receipt as received", () => {
    const e=evidence();
    for(const status of ["AWAITING_PAYMENT","FAILED","PENDING","UNKNOWN","SETTLED"]) {
      expect(signingDispatchDecision({ ...e, payment: { ...e.payment!, status } }).allowed).toBe(false);
    }
    for(const wrong of [
      { ...receipt, customerId: "another-customer" },
      { ...receipt, amountCents: 4799 },
      { ...receipt, receivedOn: new Date(NaN) },
    ]) {
      expect(signingDispatchDecision({ ...e, payment: {
        ...e.payment!, status: "SETTLED", receipt: wrong,
      } }).allowed).toBe(false);
    }
  });
  it("rejects changed fingerprint, accepted amount, version, signed time and tax breakdown", () => {
    const e=evidence();
    const paid={ ...e.payment!, status:"SETTLED", receipt };
    const cases: SigningDispatchEvidence[]=[
      { ...e, signature: { ...e.signature!, signingOrderFingerprint:"c".repeat(64) }, payment:paid },
      { ...e, payment: { ...paid, orderFingerprint:"c".repeat(64) } },
      { ...e, payment: { ...paid, totalCents:4801 } },
      { ...e, payment: { ...paid, evidenceVersion:2 } },
      { ...e, payment: { ...paid, signedAt:new Date("2026-10-13T13:00:00Z") } },
      { ...e, payment: { ...paid, setupTaxCents:500 } },
    ];
    for(const value of cases) expect(signingDispatchDecision(value).allowed).toBe(false);
  });
  it("accepts only matched received money or a genuine signed zero-due obligation", () => {
    const e=evidence();
    expect(signingDispatchDecision({ ...e, payment: {
      ...e.payment!, status:"SETTLED", receipt,
    } })).toEqual({ allowed:true, legacy:false });
    expect(signingDispatchDecision({
      ...e,
      signature:{ ...e.signature!, signingAllInCents:0 },
      payment:{ ...e.payment!, status:"NOT_DUE",
        setupFeeCents:0,setupTaxCents:0,downPaymentCents:0,totalCents:0,receipt:null },
    })).toEqual({ allowed:true, legacy:false });
  });
});
