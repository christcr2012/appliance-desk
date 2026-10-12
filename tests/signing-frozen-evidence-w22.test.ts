import { describe, expect, it } from "vitest";
import type { SigningOrderDraftContract } from "@/domains/billing/signing-order-draft-contract";
import { buildFrozenSigningEvidence } from "@/domains/billing/signing-frozen-evidence";

const draft = (): SigningOrderDraftContract => ({
  status: "OWNER_DRAFT_ONLY", reasons: [],
  sourceFingerprint: "a".repeat(64), draftFingerprint: "b".repeat(64),
  eligibleForSigning: false, eligibleForCollection: false,
  totals: { setupFeeCents: 4500, downPaymentCents: 3500, setupTaxCents: 135,
    allInCandidateCents: 8135 },
  lines: [{
    agreementId: "agreement-1", serviceAddressId: "address-1", version: 3,
    setupFeeCents: 4500, downPaymentCents: 3500, setupTaxCents: 135,
    allInCandidateCents: 8135, jurisdictionEvidence: [{
      jurisdictionId: "colorado", rateVersionId: "rate-1",
      taxableCents: 4500, exemptCents: 0, taxCents: 135,
    }],
  }],
});

describe("W-22C5 frozen money evidence", () => {
  it("freezes exact independent per-jurisdiction cents and immutable version provenance", () => {
    const result = buildFrozenSigningEvidence(draft());
    expect(result).toEqual([expect.objectContaining({
      schemaVersion: 1, agreementId: "agreement-1", agreementVersion: 3,
      sourceFingerprint: "a".repeat(64), orderFingerprint: "b".repeat(64),
      setupFeeCents: 4500, downPaymentCents: 3500, setupTaxCents: 135, allInCents: 8135,
    })]);
    expect(result[0].jurisdictions).toHaveLength(1);
  });
  it("rejects unreadied, incomplete or untrusted tax candidates", () => {
    for (const alter of [
      (v: SigningOrderDraftContract) => { v.status = "BLOCKED"; },
      (v: SigningOrderDraftContract) => { v.draftFingerprint = null; },
      (v: SigningOrderDraftContract) => { v.reasons = ["CPA review missing"]; },
      (v: SigningOrderDraftContract) => { v.totals = null; },
    ]) {
      const value = draft(); alter(value);
      expect(() => buildFrozenSigningEvidence(value)).toThrow();
    }
  });
  it("rejects mismatching jurisdiction tax, arithmetic or aggregates", () => {
    for (const alter of [
      (v: SigningOrderDraftContract) => { v.lines[0].jurisdictionEvidence[0].taxCents = 100; },
      (v: SigningOrderDraftContract) => { v.lines[0].allInCandidateCents = 8136; },
      (v: SigningOrderDraftContract) => { v.totals!.setupFeeCents = 9000; },
      (v: SigningOrderDraftContract) => { v.lines[0].downPaymentCents = -1; },
    ]) {
      const value = draft(); alter(value);
      expect(() => buildFrozenSigningEvidence(value)).toThrow();
    }
  });
  it("never allocates twice to the same agreement", () => {
    const value = draft(); value.lines.push({ ...value.lines[0] });
    expect(() => buildFrozenSigningEvidence(value)).toThrow();
  });
});
