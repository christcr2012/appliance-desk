import { describe, expect, it } from "vitest";
import { renderSignedAgreement, type SignedAgreementPayload } from "@/domains/documents/render";

const payload = (): SignedAgreementPayload => ({
  agreementId: "agreement-a",
  business: { name: "Robinson Appliance Rentals", phone: "555-0100",
    email: "billing@example.test", address: "Colorado" },
  customer: { name: "Customer", email: "customer@example.test" },
  serviceAddress: "1 Property St, Greeley, CO 80631",
  termMonths: null,
  lines: [{ label: "Washer", monthlyPriceCents: 3500, listPriceCents: 3500,
    prepayDiscountCentsPerMonth: 0 }],
  monthlyTotalCents: 3500, depositCents: 0, damageWaiverCents: 0,
  lateFeeGraceDays: 5, lateFeeCents: 0, lateFeePercent: 0,
  taxRateMilliPercent: 0, paidInFullInAdvance: false, freeMonthGranted: false,
  terms: { ending: null, autoRenew: null },
  signature: { signerName: "Customer", signerEmail: "customer@example.test",
    ipAddress: null, signedAt: "2026-10-11T19:00:00.000Z" },
  frozenSigning: { schemaVersion: 1, orderFingerprint: "a".repeat(64),
    setupFeeCents: 4500, setupTaxCents: 135,
    downPaymentCents: 3500, allInCents: 8135 },
});

describe("W-22 signed artifact freezes tax-inclusive one-time charges", () => {
  it("displays exact cents, provenance and never describes charges as paid", () => {
    const html = renderSignedAgreement(payload());
    expect(html).toContain("Setup: $45");
    expect(html).toContain("Setup tax: $1.35");
    expect(html).toContain("Down payment: $35");
    expect(html).toContain("Tax-inclusive signing amount: $81.35");
    expect(html).toContain("Not a payment receipt");
    expect(html).toContain("Any collected down payment");
    expect(html).toContain("a".repeat(64));
    expect(html).toContain("Monthly total: $35");
  });
  it("rejects mismatched or negative monetary facts", () => {
    const value = payload();
    value.frozenSigning!.allInCents++;
    expect(() => renderSignedAgreement(value)).toThrow(/do not reconcile/);
    value.frozenSigning!.allInCents = 8135;
    value.frozenSigning!.setupFeeCents = -1;
    expect(() => renderSignedAgreement(value)).toThrow(/do not reconcile/);
  });
  it("retains backward rendering for historical agreements without W-22 proof", () => {
    const value = payload();
    delete value.frozenSigning;
    const html = renderSignedAgreement(value);
    expect(html).not.toContain("Reviewed signing charges");
  });
});
