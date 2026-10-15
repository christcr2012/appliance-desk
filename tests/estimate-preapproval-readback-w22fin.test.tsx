import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewedPreapprovalQuote } from "@/components/estimates/reviewed-preapproval-quote";
import type { EstimatePreparedQuote } from "@/domains/estimates/preapproval-quote";

const reviewed: EstimatePreparedQuote = {
  status: "READY", reasons: [], quoteFingerprint: "a".repeat(64),
  orderFingerprint: "b".repeat(64), permissionToCollect: false,
  locations: [
    { agreementId: "a", serviceAddressId: "one", serviceAddress: "100 Test St",
      monthlyRentCents: 6000, monthlyRentTaxCents: 510,
      setupFeeCents: 4500, setupTaxCents: 390, advanceCents: 6000,
      signingAmountCents: 10890, rateVersionIds: ["r1"] },
    { agreementId: "b", serviceAddressId: "two", serviceAddress: "200 Test St",
      monthlyRentCents: 3500, monthlyRentTaxCents: 280,
      setupFeeCents: 4500, setupTaxCents: 390, advanceCents: 3500,
      signingAmountCents: 8390, rateVersionIds: ["r2"] },
  ],
  totals: { monthlyRentCents: 9500, monthlyRentTaxCents: 790,
    setupFeeCents: 9000, setupTaxCents: 780,
    advanceCents: 9500, dueAtSigningCents: 19280 },
};
describe("reviewed preapproval multi-location estimate presentation", () => {
  it("shows each actual site, monthly tax and separate signing obligation without a paid claim", () => {
    const html = renderToStaticMarkup(<ReviewedPreapprovalQuote quote={reviewed} />);
    expect(html).toContain("100 Test St");
    expect(html).toContain("200 Test St");
    expect(html).toContain("$95");
    expect(html).toContain("$7.90");
    expect(html).toContain("$192.80");
    expect(html).toMatch(/not yet paid/i);
    expect(html).toMatch(/future bill tax/i);
    expect(html).not.toContain("Quote fingerprint");
    expect(html).not.toMatch(/payment confirmed/i);
  });
  it("hides every candidate amount when any verification fails", () => {
    const invalid: EstimatePreparedQuote = { ...reviewed,
      status: "REVIEW_REQUIRED", quoteFingerprint: null, orderFingerprint: null,
      totals: null, locations: [], reasons: ["Mismatched owned signing agreement"] };
    const html = renderToStaticMarkup(<ReviewedPreapprovalQuote quote={invalid} />);
    expect(html).not.toContain("$192.80");
    expect(html).not.toContain("100 Test St");
    expect(html).not.toContain("Mismatched owned signing agreement");
    expect(html).toMatch(/not a price that may be accepted/i);
    const ownerHtml = renderToStaticMarkup(<ReviewedPreapprovalQuote quote={invalid} owner />);
    expect(ownerHtml).toContain("Mismatched owned signing agreement");
  });
});
