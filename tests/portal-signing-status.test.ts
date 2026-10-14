import { describe, expect, it } from "vitest";
import { customerSigningSummary, type CustomerSigningEvidence } from "@/domains/portal/signing-status";
const signedAt = new Date("2026-10-14T12:00:00Z");
const payment = (extra: Partial<CustomerSigningEvidence> = {}): CustomerSigningEvidence => ({
  setupFeeCents: 1000, setupTaxCents: 100, downPaymentCents: 1900, totalCents: 3000,
  status: "AWAITING_PAYMENT", signedAt, receipt: null, ...extra,
});
describe("customer signing evidence recovered from unfinished portal work", () => {
  it("does not invent an obligation or receipt", () => {
    expect(customerSigningSummary(null, "customer-a")).toBeNull();
    expect(customerSigningSummary(payment(), "customer-a")).toMatchObject({ status: "AWAITING_PAYMENT", receivedOn: null });
  });
  it("recognizes a recorded same-customer exact-amount settled receipt, not invoice credit", () => {
    const summary = customerSigningSummary(payment({ status: "SETTLED", receipt: {
      customerId: "customer-a", amountCents: 3000, receivedOn: signedAt,
    } }), "customer-a");
    expect(summary).toMatchObject({ status: "RECEIVED", totalCents: 3000, receivedOn: signedAt });
    expect(summary).not.toHaveProperty("invoicePaid");
    expect(summary).not.toHaveProperty("creditApplied");
    expect(summary).not.toHaveProperty("customerId");
  });
  it("never calls a foreign, wrong-amount or invalid-date receipt received", () => {
    for (const receipt of [
      { customerId: "customer-b", amountCents: 3000, receivedOn: signedAt },
      { customerId: "customer-a", amountCents: 2999, receivedOn: signedAt },
      { customerId: "customer-a", amountCents: 3000, receivedOn: new Date(NaN) },
    ]) expect(customerSigningSummary(payment({ status: "SETTLED", receipt }), "customer-a")?.status).toBe("REVIEW_REQUIRED");
  });
  it("does not display corrupt or unsigned amounts as payable", () => {
    for (const extra of [{ totalCents: 3001 }, { setupTaxCents: -1 },
      { downPaymentCents: Number.MAX_SAFE_INTEGER }, { signedAt: new Date(NaN) }]) {
      expect(customerSigningSummary(payment(extra), "customer-a")).toMatchObject({
        status: "REVIEW_REQUIRED", totalCents: null, setupFeeCents: null, receivedOn: null,
      });
    }
  });
  it("requires a zero obligation with no receipt for NOT_DUE", () => {
    expect(customerSigningSummary(payment({ status: "NOT_DUE", totalCents: 0,
      setupFeeCents: 0, setupTaxCents: 0, downPaymentCents: 0 }), "customer-a")?.status).toBe("NOT_DUE");
    expect(customerSigningSummary(payment({ status: "NOT_DUE" }), "customer-a")?.status).toBe("REVIEW_REQUIRED");
  });
  it("keeps ambiguous provider states open and never infers payment from a signature", () => {
    for (const status of ["PENDING", "UNKNOWN", "FAILED", "SETTLED"])
      expect(customerSigningSummary(payment({ status }), "customer-a")?.status).toBe("REVIEW_REQUIRED");
  });
});
