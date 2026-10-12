import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { signingInvoiceMirrorProof } from "@/domains/billing/signing-invoice-mirror";

const c = {
  agreementId: "agr-A", orderFingerprint: "a".repeat(64),
  amountCents: 3500, receiptId: "receipt-A",
};
const applied = { ...c, stripeInvoiceId: "in_A", stripeInvoiceLineId: "il_A" };
const line = { id: "il_A", invoice: "in_A", amount: -3500, metadata: {
  signing_credit_agreement: "agr-A", signing_credit_order: "a".repeat(64),
  signing_credit_receipt: "receipt-A",
}} as unknown as Stripe.InvoiceLineItem;
const invoice = { id: "in_A", lines: { data: [line], has_more: false } } as Stripe.Invoice;
function fixture(entitlement: typeof c | null, application: typeof applied | null) {
  const tx = {
    signingDownPaymentCredit: { findUnique: vi.fn().mockResolvedValue(entitlement) },
    signingFirstInvoiceApplication: { findUnique: vi.fn().mockResolvedValue(application) },
  } as unknown as Prisma.TransactionClient;
  return tx;
}
describe("W-22 first-invoice webhook mirror ownership", () => {
  it("recognizes the one authentic first-invoice negative credit", async () => {
    await expect(signingInvoiceMirrorProof(fixture(c, applied), "agr-A", invoice))
      .resolves.toMatchObject({ lineId: "il_A", description: expect.stringContaining("First month") });
  });
  it("fails closed before provider readback and for a foreign invoice", async () => {
    await expect(signingInvoiceMirrorProof(fixture(c, null), "agr-A", invoice)).rejects.toThrow();
    await expect(signingInvoiceMirrorProof(fixture(null, null), "agr-A", invoice)).rejects.toThrow();
    await expect(signingInvoiceMirrorProof(fixture(c, applied), "agr-A", {
      ...invoice, id: "in_B",
    })).rejects.toThrow();
  });
  it("rejects duplicate, altered, missing or truncated invoice credit evidence", async () => {
    for (const lines of [
      [], [line, line], [{ ...line, amount: -3499 }],
      [{ ...line, metadata: { ...line.metadata, signing_credit_receipt: "receipt-B" } }],
    ]) {
      await expect(signingInvoiceMirrorProof(fixture(c, applied), "agr-A", {
        ...invoice, lines: { data: lines, has_more: false } as unknown as Stripe.ApiList<Stripe.InvoiceLineItem>,
      })).rejects.toThrow();
    }
    await expect(signingInvoiceMirrorProof(fixture(c, applied), "agr-A", {
      ...invoice, lines: { data: [line], has_more: true } as unknown as Stripe.ApiList<Stripe.InvoiceLineItem>,
    })).rejects.toThrow();
  });
  it("does not apply signing credits again to later subscription invoices", async () => {
    await expect(signingInvoiceMirrorProof(fixture(c, applied), "agr-A", {
      ...invoice, id: "in_renewal",
      lines: { data: [], has_more: false } as unknown as Stripe.ApiList<Stripe.InvoiceLineItem>,
    })).resolves.toBeNull();
  });
});
