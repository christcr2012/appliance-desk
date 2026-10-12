import { describe, it, expect } from "vitest";
import { signedPaymentObligation } from "@/domains/billing/signing-payment-obligation";
import type { FrozenSigningEvidence } from "@/domains/billing/signing-frozen-evidence";
const line: FrozenSigningEvidence = {
  schemaVersion: 1, agreementId: "a", serviceAddressId: "addr", agreementVersion: 1,
  sourceFingerprint: "b".repeat(64), orderFingerprint: "a".repeat(64),
  setupFeeCents: 4500, setupTaxCents: 150, downPaymentCents: 6000,
  allInCents: 10650, jurisdictions: [],
};
describe("W-22 immutable payment obligation", () => {
  it("preserves per-agreement cents, down payment separately and original signed time", () => {
    const signedAt = new Date("2026-10-12T12:00:00Z");
    expect(signedPaymentObligation(line, signedAt)).toEqual({
      agreementId:"a",orderFingerprint:"a".repeat(64),evidenceVersion:1,
      setupFeeCents:4500,setupTaxCents:150,downPaymentCents:6000,totalCents:10650,
      status:"AWAITING_PAYMENT",signedAt,
    });
  });
  it("records a fully waived fee as NOT_DUE, never a paid receipt", () => {
    expect(signedPaymentObligation({...line,setupFeeCents:0,setupTaxCents:0,downPaymentCents:0,allInCents:0},new Date()).status).toBe("NOT_DUE");
  });
  it("fails closed on mismatched, negative, unsafe and mutated fingerprint evidence", () => {
    for (const bad of [
      {...line,allInCents:150}, {...line,setupFeeCents:-1},
      {...line,downPaymentCents:Number.MAX_SAFE_INTEGER},
      {...line,orderFingerprint:"bad"},
    ]) expect(() => signedPaymentObligation(bad,new Date())).toThrow(/reconciled/);
    expect(() => signedPaymentObligation(line,new Date(NaN))).toThrow(/reconciled/);
  });
});
