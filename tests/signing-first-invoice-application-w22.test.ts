import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  signingFirstInvoiceItem, verifySigningFirstInvoiceCredit,
  SIGNING_CREDIT_META_AGREEMENT, SIGNING_CREDIT_META_ORDER,
  SIGNING_CREDIT_META_RECEIPT,
} from "@/domains/billing/signing-first-invoice-application";

const evidence = {
  agreementId: "agr-A", receiptId: "receipt-A", amountCents: 3500,
  orderFingerprint: "a".repeat(64),
};
const invoice = {
  id: "in_A", livemode: false, billing_reason: "subscription_create", currency: "usd",
  parent: { subscription_details: { subscription: "sub_A" } },
  customer: "cus_A", status: "open",
} as Stripe.Invoice;
const line = {
  id: "il_A", livemode: false, invoice: "in_A", amount: -3500,
  metadata: {
    [SIGNING_CREDIT_META_AGREEMENT]: "agr-A",
    [SIGNING_CREDIT_META_ORDER]: "a".repeat(64),
    [SIGNING_CREDIT_META_RECEIPT]: "receipt-A",
  },
} as unknown as Stripe.InvoiceLineItem;

const verify = (
  inv: Stripe.Invoice = invoice, lines: Stripe.InvoiceLineItem[] = [line],
  hasMore = false,
) => verifySigningFirstInvoiceCredit(evidence, "sub_A", "cus_A", inv, lines, hasMore);

describe("W-22 provider-specific first-invoice application", () => {
  it("builds an agreement-bound negative invoice item, never a customer balance mutation", () => {
    const item = signingFirstInvoiceItem(evidence, "prod_rent");
    expect(item.price_data?.unit_amount).toBe(-3500);
    expect(item.discountable).toBe(false);
    expect(item.tax_rates).toEqual([]);
    expect(item.metadata).toMatchObject({ signing_credit_agreement: "agr-A", signing_credit_receipt: "receipt-A" });
    expect(() => signingFirstInvoiceItem({ ...evidence, amountCents: 0 }, "prod_rent")).toThrow();
    expect(() => signingFirstInvoiceItem({ ...evidence, orderFingerprint: "bad" }, "prod_rent")).toThrow();
  });
  it("accepts only the exact first invoice and one signed receipt credit without claiming payment", () => {
    expect(verify()).toMatchObject({ agreementId: "agr-A", stripeInvoiceId: "in_A", stripeInvoiceLineId: "il_A", amountCents: 3500 });
    expect(() => verify(invoice, [line, line])).toThrow();
    expect(() => verify(invoice, [line], true)).toThrow();
  });
  it("refuses another account, agreement, amount, receipt, invoice and provider status", () => {
    const invalidInvoices: Partial<Stripe.Invoice>[] = [
      { customer: "cus_B" }, { currency: "eur" }, { billing_reason: "subscription_cycle" },
      { livemode: true }, { status: "void" },
      { parent: { subscription_details: { subscription: "sub_B" } } as Stripe.Invoice.Parent },
    ];
    for (const change of invalidInvoices) expect(() => verify({ ...invoice, ...change })).toThrow();
    const invalidLines: Partial<Stripe.InvoiceLineItem>[] = [
      { amount: -3499 }, { invoice: "in_B" }, { livemode: true },
      { metadata: { ...line.metadata, signing_credit_receipt: "receipt-B" } },
      { metadata: { ...line.metadata, signing_credit_order: "b".repeat(64) } },
      { metadata: { ...line.metadata, signing_credit_agreement: "agr-B" } },
    ];
    for (const change of invalidLines) expect(() => verify(invoice, [{ ...line, ...change }])).toThrow();
    expect(() => verify(invoice, [])).toThrow();
  });
});
