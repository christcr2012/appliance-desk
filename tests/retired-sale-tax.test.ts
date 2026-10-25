import { describe, expect, it } from "vitest";
import { estimateRetiredSale, needsCpaFollowUp, type TaxEvidence } from "@/domains/sales/retired-sale-tax";

// The acceptance cases of docs/designs/RETIRED-APPLIANCE-RESALE-TAX-2026-10-08.md section 3. Money is whole cents.
const rental = (over: Partial<TaxEvidence> = {}): TaxEvidence => ({
  classification: "RENTAL_ASSET", confidence: "CPA_CONFIRMED",
  originalBasisCents: 60000, signedAdjustmentsCents: null, allowedDepreciationCents: 40000, section179Cents: null, bonusDepreciationCents: null,
  ...over,
});

describe("retired appliance sale: income-tax estimate", () => {
  it("$600 basis, $400 depreciation, sold for $600: $200 left, $400 gain, $400 may be recapture", () => {
    const r = estimateRetiredSale({ priceCents: 60000, evidence: rental() });
    expect(r).toMatchObject({ status: "CPA_CONFIRMED_ESTIMATE", adjustedBasisCents: 20000, taxGainCents: 40000, potentialRecaptureCents: 40000, otherGainCents: 0, reasons: [] });
    expect(needsCpaFollowUp(r.status)).toBe(false);
  });

  it("same appliance sold for $750: $550 gain, $400 may be recapture, $150 left for the accountant to classify", () => {
    const r = estimateRetiredSale({ priceCents: 75000, evidence: rental() });
    expect(r).toMatchObject({ taxGainCents: 55000, potentialRecaptureCents: 40000, otherGainCents: 15000 });
  });

  it("fully depreciated $600 appliance sold for $250: the whole $250 is gain (an old unit is not a zero gain)", () => {
    const r = estimateRetiredSale({ priceCents: 25000, evidence: rental({ allowedDepreciationCents: 60000 }) });
    expect(r).toMatchObject({ adjustedBasisCents: 0, taxGainCents: 25000, potentialRecaptureCents: 25000, otherGainCents: 0 });
  });

  it("$600 cost, no depreciation taken, sold for $450: a $150 loss and no recapture", () => {
    const r = estimateRetiredSale({ priceCents: 45000, evidence: rental({ allowedDepreciationCents: 0 }) });
    expect(r).toMatchObject({ taxGainCents: -15000, potentialRecaptureCents: 0, otherGainCents: 0 });
  });

  it("the owner's costs of selling reduce the gain; the price itself is never limited", () => {
    const r = estimateRetiredSale({ priceCents: 60000, sellerCostsCents: 5000, evidence: rental() });
    expect(r).toMatchObject({ netProceedsCents: 55000, taxGainCents: 35000, potentialRecaptureCents: 35000 });
    expect(estimateRetiredSale({ priceCents: 5_000_000, evidence: rental() }).taxGainCents).toBe(5_000_000 - 20000);
  });

  it("section 179 and bonus depreciation count as depreciation taken, and basis adjustments change the basis", () => {
    const r = estimateRetiredSale({ priceCents: 60000, evidence: rental({ originalBasisCents: 60000, signedAdjustmentsCents: 5000, allowedDepreciationCents: 20000, section179Cents: 10000, bonusDepreciationCents: 10000 }) });
    expect(r).toMatchObject({ totalDepreciationCents: 40000, adjustedBasisCents: 25000, taxGainCents: 35000, potentialRecaptureCents: 35000 });
  });

  it("no evidence, unknown evidence or missing numbers: review needed and no tax numbers at all", () => {
    for (const evidence of [null, rental({ confidence: "UNKNOWN" }), rental({ classification: "UNKNOWN" }), rental({ originalBasisCents: null }), rental({ allowedDepreciationCents: null })]) {
      const r = estimateRetiredSale({ priceCents: 60000, evidence });
      expect(r).toMatchObject({ status: "CPA_REVIEW_NEEDED", adjustedBasisCents: null, taxGainCents: null, potentialRecaptureCents: null, otherGainCents: null });
      expect(r.reasons.length).toBeGreaterThan(0);
      expect(needsCpaFollowUp(r.status)).toBe(true);
    }
  });

  it("an expensed, resale-stock or other item never gets an invented depreciation record", () => {
    for (const classification of ["EXPENSED", "INVENTORY", "OTHER"]) {
      const r = estimateRetiredSale({ priceCents: 60000, evidence: rental({ classification }) });
      expect(r).toMatchObject({ status: "CPA_REVIEW_NEEDED", potentialRecaptureCents: null });
    }
  });

  it("numbers only the owner typed are shown as an unconfirmed estimate and still need the accountant", () => {
    const r = estimateRetiredSale({ priceCents: 60000, evidence: rental({ confidence: "OWNER_SUPPLIED" }) });
    expect(r.status).toBe("UNCONFIRMED_ESTIMATE");
    expect(r.potentialRecaptureCents).toBe(40000);
    expect(r.reasons).toHaveLength(1);
    expect(needsCpaFollowUp(r.status)).toBe(true);
  });

  it("depreciation larger than the basis is sent to the accountant instead of producing a negative basis", () => {
    const r = estimateRetiredSale({ priceCents: 60000, evidence: rental({ allowedDepreciationCents: 70000 }) });
    expect(r).toMatchObject({ status: "CPA_REVIEW_NEEDED", adjustedBasisCents: null });
  });
});
