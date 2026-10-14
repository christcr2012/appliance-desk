import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SigningPaymentSummary } from "@/components/billing/signing-payment-summary";
import type { CustomerSigningSummary } from "@/domains/portal/signing-status";

const base: CustomerSigningSummary = {
  setupFeeCents: 4500, setupTaxCents: 300, downPaymentCents: 6000,
  totalCents: 10800, status: "AWAITING_PAYMENT", receivedOn: null,
};
const render = (row: CustomerSigningSummary | null) =>
  renderToStaticMarkup(createElement(SigningPaymentSummary, { summary: row }));

describe("W-22FIN shared owner and customer signing readback", () => {
  it("has no signing claim for missing evidence", () => {
    expect(render(null)).toBe("");
  });
  it("discloses the exact signed components without saying due means paid", () => {
    const html = render(base);
    expect(html).toContain("$45");
    expect(html).toContain("$3");
    expect(html).toContain("$60");
    expect(html).toContain("$108");
    expect(html).toContain("awaiting verified payment");
    expect(html).not.toContain("recorded as received");
    expect(html).toContain("first delivery invoice");
  });
  it("only displays a genuine verified paid date and never labels invoice credit applied", () => {
    const html = render({ ...base, status: "RECEIVED", receivedOn: new Date("2026-10-14T12:00:00Z") });
    expect(html).toContain("recorded as received");
    expect(html).not.toContain("awaiting verified payment");
    expect(html).not.toContain("invoice paid");
  });
  it("shows not due for signed zero amount without claiming a receipt", () => {
    const html = render({ setupFeeCents: 0, setupTaxCents: 0,
      downPaymentCents: 0, totalCents: 0, status: "NOT_DUE", receivedOn: null });
    expect(html).toContain("No signing payment is due");
    expect(html).not.toContain("recorded as received");
  });
  it("fails closed without revealing corrupt or foreign receipt amounts", () => {
    for (const summary of [
      { ...base, status: "REVIEW_REQUIRED" as const, totalCents: 10800 },
      { ...base, status: "RECEIVED" as const, totalCents: null },
      { ...base, status: "AWAITING_PAYMENT" as const, setupFeeCents: -1 },
    ]) {
      const html = render(summary);
      expect(html).toContain("needs review");
      expect(html).not.toContain("$108");
      expect(html).not.toContain("recorded as received");
    }
  });
});
