import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { SIGNING_FIRST_INVOICE_DESCRIPTION } from "@/domains/billing/signing-first-invoice-application";
import type { InvoiceDetail } from "@/domains/billing/invoice-detail";

function fixture(paid = 0, status = "OPEN"): InvoiceDetail {
  return {
    id: "in-internal", invoiceNumber: 1001, status, createdAt: new Date("2026-10-12T12:00:00Z"),
    billingPeriodStart: null, billingPeriodEnd: null, dueDate: null,
    subtotalCents: 0, discountCents: 0, taxCents: 480, lateFeeCents: 0,
    amountDueCents: 480, amountPaidCents: paid, balanceCents: Math.max(0, 480 - paid), beingConfirmedCents: 0,
    isLocalInvoice: false,
    isShopSale: false,
    lineItems: [
      { id: "rental", kind: "RENTAL", description: "Washer + dryer rent", amountCents: 6000, quantity: 1 },
      { id: "credit", kind: "CREDIT", description: SIGNING_FIRST_INVOICE_DESCRIPTION, amountCents: -6000, quantity: 1 },
      { id: "tax", kind: "TAX", description: "Sales tax", amountCents: 480, quantity: 1 },
    ],
    payments: paid ? [{
      id: "paid", amountCents: paid, method: "card", status: "SUCCEEDED",
      createdAt: new Date("2026-10-12T13:00:00Z"),
    }] : [],
    customer: { id: "customer-a", name: "Invoice Customer", companyName: null, email: "invoice@example.test" },
    propertyAddress: "100 Test St, Greeley, CO 80631",
    business: { name: "Robinson Appliance Rentals", phone: "555-0100", email: "billing@example.test", address: "Greeley, CO", logoUrl: null },
  };
}
function render(invoice: InvoiceDetail) {
  return renderToStaticMarkup(createElement(InvoiceDocument, { invoice }));
}
describe("W-22D12 shared owner/customer invoice document", () => {
  it("shows the one already-applied -$60 signing credit, $4.80 tax, $4.80 due, $0 paid and $4.80 outstanding; remains OPEN", () => {
    const html = render(fixture());
    expect(html).toContain(SIGNING_FIRST_INVOICE_DESCRIPTION);
    expect(html).toContain("-$60");
    expect(html).toContain("$4.80");
    expect(html).toContain("Paid on this invoice");
    expect(html).toContain("not subtracted again");
    expect(html).toContain("Open");
    expect(html).not.toContain(">Paid</span>");
    expect(html.match(/-\$60/g)).toHaveLength(1);
  });
  it("separately received $4.80 changes only the paid amount and remaining balance", () => {
    const html = render(fixture(480, "PAID"));
    expect(html).toContain("Card");
    expect(html).toContain("Balance owed");
    expect(html).toContain("$0");
    expect(html.match(/-\$60/g)).toHaveLength(1);
  });
  it("never claims signing payment for an unapplied, pending or legacy invoice", () => {
    const pending = fixture();
    pending.lineItems = pending.lineItems.filter((line) => line.kind !== "CREDIT");
    pending.subtotalCents = 6000;
    pending.amountDueCents = 6480;
    pending.balanceCents = 6480;
    expect(render(pending)).not.toContain("not subtracted again");
    expect(render(pending)).not.toContain(SIGNING_FIRST_INVOICE_DESCRIPTION);
    const legacy = fixture();
    legacy.lineItems[1] = { ...legacy.lineItems[1]!, kind: "OTHER", description: "Legacy adjustment" };
    expect(render(legacy)).not.toContain("not subtracted again");
  });
});
