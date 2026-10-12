import { describe, expect, it } from "vitest";
import { assembleSigningOrderDraft } from "@/domains/billing/signing-order-draft-contract";
import { buildFrozenSigningEvidence } from "@/domains/billing/signing-frozen-evidence";
import { verifyFrozenSigningOrder, type StoredSigningEvidence } from "@/domains/billing/signing-frozen-verify";

const sourceFingerprint = "a".repeat(64);
function fixture(): StoredSigningEvidence[] {
  const agreements = ["agreement-a", "agreement-b"].map((agreementId, i) => ({
    agreementId, serviceAddressId: "location-" + i,
    sourceFingerprint, version: 1, firstMonthRentCents: 3500,
    setupFeeCents: 4500, downPaymentCents: 3500,
  }));
  const taxRows = agreements.map(row => ({
    agreementId: row.agreementId, serviceAddressId: row.serviceAddressId, version: 1,
    review: {
      status: "CALCULATED_DRAFT" as const, eligibleForCollection: false as const, reasons: [],
      setupTaxCents: 100, candidateSigningTotalCents: 8100,
      jurisdictionLines: [{
        lineKey: "administrative-setup", jurisdictionId: "co", rateVersionId: "rate",
        category: "ADMINISTRATIVE_SETUP" as const, taxableCents: 4500,
        exemptCents: 0, exemptReason: null, taxCents: 100,
      }],
    },
  }));
  const candidate = assembleSigningOrderDraft({ agreements, taxRows });
  if (candidate.status !== "OWNER_DRAFT_ONLY") throw new Error("Invalid fixture");
  const lines = buildFrozenSigningEvidence(candidate);
  return lines.map(line => ({
    agreementId: line.agreementId,
    serviceAddressId: line.serviceAddressId, sourceFingerprint, version: line.agreementVersion,
    setupFeeCents: line.setupFeeCents, downPaymentCents: line.downPaymentCents,
    frozenAt: new Date(), frozenOrderFingerprint: line.orderFingerprint,
    frozenAllInCents: line.allInCents, frozenSetupTaxCents: line.setupTaxCents,
    frozenChargeEvidence: structuredClone(line),
  })) satisfies StoredSigningEvidence[];
}

describe("W-22C6 verification of frozen tax-inclusive customer obligations", () => {
  it("recomputes an order-wide digest regardless of read order", () => {
    const rows = fixture();
    expect(verifyFrozenSigningOrder([...rows].reverse(), ["agreement-b", "agreement-a"])
      .map(r => r.allInCents)).toEqual([8100, 8100]);
  });
  it("rejects dropped or duplicated agreements and missing payload", () => {
    const rows = fixture();
    expect(() => verifyFrozenSigningOrder(rows.slice(0, 1), rows.map(r => r.agreementId))).toThrow();
    expect(() => verifyFrozenSigningOrder([rows[0], rows[0]], rows.map(r => r.agreementId))).toThrow();
    rows[0].frozenChargeEvidence = null;
    expect(() => verifyFrozenSigningOrder(rows, rows.map(r => r.agreementId))).toThrow();
  });
  it("detects altered amounts, tax evidence, versions and saved fingerprints", () => {
    for (const mutate of [
      (r: StoredSigningEvidence) => { r.frozenAllInCents = 0; },
      (r: StoredSigningEvidence) => { r.frozenSetupTaxCents = 0; },
      (r: StoredSigningEvidence) => { r.version = 2; },
      (r: StoredSigningEvidence) => { (r.frozenChargeEvidence as { jurisdictions: { taxCents: number }[] }).jurisdictions[0].taxCents++; },
      (r: StoredSigningEvidence) => { r.frozenOrderFingerprint = "0".repeat(64); },
    ]) {
      const rows = fixture(); mutate(rows[0]);
      expect(() => verifyFrozenSigningOrder(rows, rows.map(r => r.agreementId))).toThrow();
    }
  });
  it("does not allow a frozenAt-only legacy value to masquerade as reviewed signing proof", () => {
    const rows = fixture(); rows[0].frozenAllInCents = null;
    expect(() => verifyFrozenSigningOrder(rows, rows.map(r => r.agreementId))).toThrow();
  });
});
