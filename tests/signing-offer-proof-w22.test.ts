import { describe, expect, it } from "vitest";
import { offerMatchesFrozenEvidence } from "@/domains/agreements/signing-offer-proof";
const line = { orderFingerprint: "a".repeat(64), allInCents: 8135, schemaVersion: 1 as const };
const offered = {
  signingOrderFingerprint: line.orderFingerprint,
  signingAllInCents: line.allInCents,
  signingEvidenceVersion: 1,
};
describe("W-22C6B trusted frozen signing offer", () => {
  it("accepts only the exact version, hash and all-in cents sent to the customer", () => {
    expect(offerMatchesFrozenEvidence(offered, line)).toBe(true);
  });
  it("fails closed for legacy/missing evidence and altered amounts", () => {
    expect(offerMatchesFrozenEvidence(null, line)).toBe(false);
    expect(offerMatchesFrozenEvidence(offered, undefined)).toBe(false);
    for (const wrong of [
      { ...offered, signingAllInCents: 0 },
      { ...offered, signingOrderFingerprint: "b".repeat(64) },
      { ...offered, signingEvidenceVersion: 2 },
      { ...offered, signingOrderFingerprint: null },
    ]) expect(offerMatchesFrozenEvidence(wrong, line)).toBe(false);
    expect(offerMatchesFrozenEvidence(offered, { ...line, allInCents: -1 })).toBe(false);
    expect(offerMatchesFrozenEvidence(offered, { ...line, orderFingerprint: "not-a-hash" })).toBe(false);
  });
});
