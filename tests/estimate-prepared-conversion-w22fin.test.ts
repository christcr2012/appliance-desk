import { describe, expect, it } from "vitest";
import {
  validatePreparedConversion, validateConvertedEstimateReplay,
  type PreparedConversionProof,
} from "@/domains/estimates/prepared-conversion";

const quoteFingerprint = "a".repeat(64);
const orderFingerprint = "b".repeat(64);
function fixture(): PreparedConversionProof {
  return {
    estimateId: "estimate-1", customerId: "customer-1",
    reviewedQuoteFingerprint: quoteFingerprint, reviewedOrderFingerprint: orderFingerprint,
    requestedMode: "per-property", quoteAddresses: ["address-1", "address-2"],
    prepared: [
      { id: "agreement-1", customerId: "customer-1", sourceEstimateId: "estimate-1",
        serviceAddressId: "address-1", status: "DRAFT" },
      { id: "agreement-2", customerId: "customer-1", sourceEstimateId: "estimate-1",
        serviceAddressId: "address-2", status: "DRAFT" },
    ],
    estimateDepositCents: 0, estimateDepositPaidAt: null,
    quote: {
      status: "READY", reasons: [], quoteFingerprint, orderFingerprint, permissionToCollect: false,
      locations: [
        { agreementId: "agreement-1", serviceAddressId: "address-1",
          serviceAddress: "100 Main St", monthlyRentCents: 3500, monthlyRentTaxCents: 300,
          setupFeeCents: 4500, setupTaxCents: 350, advanceCents: 3500,
          signingAmountCents: 8350, rateVersionIds: ["r1"] },
        { agreementId: "agreement-2", serviceAddressId: "address-2",
          serviceAddress: "200 Main St", monthlyRentCents: 6000, monthlyRentTaxCents: 500,
          setupFeeCents: 4500, setupTaxCents: 350, advanceCents: 6000,
          signingAmountCents: 10850, rateVersionIds: ["r2"] },
      ],
      totals: { monthlyRentCents: 9500, monthlyRentTaxCents: 800,
        setupFeeCents: 9000, setupTaxCents: 700,
        advanceCents: 9500, dueAtSigningCents: 19200 },
    },
  };
}
describe("W-22FIN exact prepared conversion adoption", () => {
  it("reuses both original agreements, never claims signing, receipt, invoice or delivery", () => {
    expect(validatePreparedConversion(fixture())).toEqual({
      agreementIds: ["agreement-1", "agreement-2"],
      orderFingerprint, quoteFingerprint,
      amountDueAtSigningCents: 19200, amountUncollectedCents: 19200,
      signed: false, paid: false, invoiced: false, dispatched: false,
    });
  });
  it("blocks changes to the original per-property amount identity", () => {
    const base = fixture();
    for (const altered of [
      { ...base, reviewedQuoteFingerprint: null },
      { ...base, reviewedOrderFingerprint: "bad" },
      { ...base, quote: { ...base.quote, quoteFingerprint: "f".repeat(64) } },
      { ...base, quote: { ...base.quote, orderFingerprint: "c".repeat(64) } },
      { ...base, quote: { ...base.quote, status: "REVIEW_REQUIRED" as const, totals: null } },
      { ...base, quote: { ...base.quote, locations: base.quote.locations.slice(0, 1) } },
      { ...base, quote: { ...base.quote, totals: { ...base.quote.totals!, dueAtSigningCents: 1 } } },
    ]) {
      expect(() => validatePreparedConversion(altered)).toThrow();
    }
  });
  it("blocks foreign, missing, repeated, already-active and wrong-property draft agreement shells", () => {
    const base = fixture();
    const one = base.prepared[0], two = base.prepared[1];
    for (const prepared of [
      [one],
      [one, { ...two, customerId: "stranger" }],
      [one, { ...two, status: "ACTIVE" }],
      [one, { ...two, serviceAddressId: "address-1" }],
      [one, { ...two, sourceEstimateId: "estimate-other" }],
      [one, { ...two, id: one.id }],
    ]) expect(() => validatePreparedConversion({ ...base, prepared })).toThrow();
  });
  it("does not accept early deposit paid claims as evidence of a collected signing obligation", () => {
    const base = fixture();
    for (const f of [
      { ...base, estimateDepositCents: 5000 },
      { ...base, estimateDepositPaidAt: new Date() },
      { ...base, estimateDepositCents: -1 },
    ]) expect(() => validatePreparedConversion(f)).toThrow(/deposit/i);
  });
  it("rejects switching a two-property original offer into one address without reissuing", () => {
    const base = fixture();
    expect(() => validatePreparedConversion({
      ...base, requestedMode: "single", requestedAddressId: "address-1",
    })).toThrow(/single-property/i);
  });
  it("converted replay accepts only exact owned unique original estimates", () => {
    const rows = fixture().prepared.map(({status: _status, ...row}) => row);
    expect(validateConvertedEstimateReplay(rows, { estimateId:"estimate-1",customerId:"customer-1" }))
      .toEqual(["agreement-1","agreement-2"]);
    for (const altered of [
      [],
      [rows[0], rows[0]],
      [rows[0], { ...rows[1], customerId: "foreign" }],
      [rows[0], { ...rows[1], sourceEstimateId: "another" }],
      [rows[0], { ...rows[1], serviceAddressId: rows[0].serviceAddressId }],
    ]) expect(() => validateConvertedEstimateReplay(altered,
      { estimateId:"estimate-1",customerId:"customer-1" })).toThrow();
  });
});
