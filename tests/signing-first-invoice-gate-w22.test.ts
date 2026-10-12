import { describe, expect, it } from "vitest";
import {
  firstInvoiceSigningBlocker,
  SIGNING_INVOICE_SETTLEMENT_BLOCKER,
  SIGNING_INVOICE_CREDIT_BLOCKER,
  SIGNING_INVOICE_EVIDENCE_BLOCKER,
} from "@/domains/billing/signing-first-invoice-gate";

const order = {
  agreementId: "agreement-A", downPaymentCents: 3500,
  status: "SETTLED", receiptId: "receipt-A", orderFingerprint: "a".repeat(64),
};
const credit = {
  agreementId: "agreement-A", receiptId: "receipt-A", amountCents: 3500,
  orderFingerprint: "a".repeat(64),
};

describe("W-22 first delivery invoice guard", () => {
  it("preserves historical no-W-22 and waived agreements", () => {
    expect(firstInvoiceSigningBlocker(null, null)).toBeNull();
    expect(firstInvoiceSigningBlocker({ ...order, downPaymentCents: 0, status: "NOT_DUE", receiptId: null }, null)).toBeNull();
  });
  it("blocks unpaid or unsettled first rent", () => {
    expect(firstInvoiceSigningBlocker({ ...order, status: "AWAITING_PAYMENT", receiptId: null }, null))
      .toBe(SIGNING_INVOICE_SETTLEMENT_BLOCKER);
    expect(firstInvoiceSigningBlocker({ ...order, status: "NOT_DUE" }, credit))
      .toBe(SIGNING_INVOICE_SETTLEMENT_BLOCKER);
  });
  it("never routes the money to another agreement or altered receipt", () => {
    for (const mismatch of [
      { agreementId: "agreement-B" }, { receiptId: "receipt-B" },
      { amountCents: 3499 }, { orderFingerprint: "b".repeat(64) },
    ]) {
      expect(firstInvoiceSigningBlocker(order, { ...credit, ...mismatch }))
        .toBe(SIGNING_INVOICE_EVIDENCE_BLOCKER);
    }
  });
  it("recognizes the settled entitlement without claiming the invoice was credited", () => {
    expect(firstInvoiceSigningBlocker(order, credit)).toBe(SIGNING_INVOICE_CREDIT_BLOCKER);
    expect(firstInvoiceSigningBlocker(order, null)).toBe(SIGNING_INVOICE_EVIDENCE_BLOCKER);
  });
  it("refuses invalid money and orphaned entitlements", () => {
    expect(firstInvoiceSigningBlocker({ ...order, downPaymentCents: -1 }, credit)).toBe(SIGNING_INVOICE_EVIDENCE_BLOCKER);
    expect(firstInvoiceSigningBlocker({ ...order, downPaymentCents: 0 }, credit)).toBe(SIGNING_INVOICE_EVIDENCE_BLOCKER);
    expect(firstInvoiceSigningBlocker(null, credit)).toBe(SIGNING_INVOICE_EVIDENCE_BLOCKER);
  });
});
