import { describe, expect, it } from "vitest";
import { assembleSigningOrderDraft, type SigningDraftFact, type SigningDraftTaxRow } from "@/domains/billing/signing-order-draft-contract";

const fingerprint = "a".repeat(64);
const fact = (changes: Partial<SigningDraftFact> = {}): SigningDraftFact => ({
  agreementId: "agreement-a", serviceAddressId: "location-a", sourceFingerprint: fingerprint,
  version: 2, firstMonthRentCents: 3500, setupFeeCents: 4500, downPaymentCents: 3500,
  ...changes,
});
const tax = (changes: Partial<SigningDraftTaxRow> = {}): SigningDraftTaxRow => ({
  agreementId: "agreement-a", serviceAddressId: "location-a", version: 2,
  review: { status: "CALCULATED_DRAFT", eligibleForCollection: false, reasons: [],
    setupTaxCents: 332, candidateSigningTotalCents: 8332,
    jurisdictionLines: [{ lineKey: "administrative-setup", jurisdictionId: "co",
      rateVersionId: "rate-7375", category: "ADMINISTRATIVE_SETUP",
      taxableCents: 4500, exemptCents: 0, exemptReason: null, taxCents: 332 }],
  }, ...changes,
});

const build = (facts: SigningDraftFact[], taxes: SigningDraftTaxRow[]) =>
  assembleSigningOrderDraft({ agreements: facts, taxRows: taxes });

describe("W-22C4 owner-only all-in order draft contract", () => {
  it("reconciles setup, tax and first-bill credit without re-taxing the credit", () => {
    expect(build([fact()], [tax()])).toMatchObject({
      status: "OWNER_DRAFT_ONLY", eligibleForSigning: false,
      eligibleForCollection: false, totals: {
        setupFeeCents: 4500, downPaymentCents: 3500,
        setupTaxCents: 332, allInCandidateCents: 8332,
      },
    });
  });
  it("is deterministic for a multi-property order independent of row input order", () => {
    const facts = [fact(), fact({ agreementId: "agreement-b", serviceAddressId: "location-b",
      firstMonthRentCents: 6000, downPaymentCents: 6000 })];
    const taxes = [tax(), tax({ agreementId: "agreement-b", serviceAddressId: "location-b",
      review: { ...tax().review, candidateSigningTotalCents: 10832 } })];
    const first = build(facts, taxes);
    const second = build([...facts].reverse(), [...taxes].reverse());
    expect(first).toEqual(second);
    expect(first).toMatchObject({ status: "OWNER_DRAFT_ONLY",
      totals: { setupFeeCents: 9000, downPaymentCents: 9500,
        setupTaxCents: 664, allInCandidateCents: 19164 } });
    expect(first.draftFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
  it("blocks missing, extra, duplicated or foreign tax agreement rows", () => {
    expect(build([fact()], []).status).toBe("BLOCKED");
    expect(build([fact()], [tax(), tax()]).status).toBe("BLOCKED");
    expect(build([fact()], [tax({ agreementId: "other" })]).status).toBe("BLOCKED");
  });
  it("blocks mismatched versions, addresses and source fingerprints", () => {
    expect(build([fact()], [tax({ version: 1 })]).status).toBe("BLOCKED");
    expect(build([fact()], [tax({ serviceAddressId: "wrong" })]).status).toBe("BLOCKED");
    const second = fact({ agreementId: "b", serviceAddressId: "location-b",
      sourceFingerprint: "b".repeat(64) });
    expect(build([fact(), second], [tax(), tax({ agreementId: "b", serviceAddressId: "location-b" })]).status).toBe("BLOCKED");
  });
  it("rejects tampered tax totals and wrong jurisdiction categories", () => {
    const t = tax();
    expect(build([fact()], [{ ...t, review: { ...t.review, candidateSigningTotalCents: 8000 } }]).status).toBe("BLOCKED");
    expect(build([fact()], [{ ...t, review: { ...t.review, jurisdictionLines: [
      { ...t.review.jurisdictionLines[0], category: "RENTAL" },
    ] } }]).status).toBe("BLOCKED");
    expect(build([fact()], [{ ...t, review: { ...t.review, jurisdictionLines: [
      t.review.jurisdictionLines[0], t.review.jurisdictionLines[0],
    ] } }]).status).toBe("BLOCKED");
  });
  it("refuses unsigned tax review or a positive second fee at the same location", () => {
    expect(build([fact()], [{ ...tax(), review: { ...tax().review, status: "REVIEW_REQUIRED" } }]).status).toBe("BLOCKED");
    const sameAddress = fact({ agreementId: "b", firstMonthRentCents: 6000,
      downPaymentCents: 6000 });
    expect(build([fact(), sameAddress], [tax(), tax({ agreementId: "b", review: {
      ...tax().review, candidateSigningTotalCents: 10832,
    } })]).status).toBe("BLOCKED");
  });
  it("fails closed for fractional, negative and overflowing money", () => {
    expect(build([fact({ setupFeeCents: -1 })], [tax()]).status).toBe("BLOCKED");
    expect(build([fact({ downPaymentCents: 1.5 })], [tax()]).status).toBe("BLOCKED");
    expect(build([fact({ downPaymentCents: Number.MAX_SAFE_INTEGER })], [tax()]).status).toBe("BLOCKED");
  });
});
