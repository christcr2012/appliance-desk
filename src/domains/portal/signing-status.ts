/**
 * Only immutable, agreement-owned W-22 evidence belongs in the customer portal.
 * A signed obligation is not itself a receipt, and first-invoice credit is a
 * separate accounting event. Keep the distinction at the DTO boundary.
 */
export type CustomerSigningEvidence = {
  setupFeeCents: number;
  setupTaxCents: number;
  downPaymentCents: number;
  totalCents: number;
  status: string;
  signedAt: Date;
  receipt: {
    customerId: string;
    amountCents: number;
    receivedOn: Date;
  } | null;
};

export type CustomerSigningSummary = {
  setupFeeCents: number | null;
  setupTaxCents: number | null;
  downPaymentCents: number | null;
  totalCents: number | null;
  status: "NOT_DUE" | "AWAITING_PAYMENT" | "RECEIVED" | "REVIEW_REQUIRED";
  receivedOn: Date | null;
};

const validCents = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function customerSigningSummary(
  payment: CustomerSigningEvidence | null,
  customerId: string,
): CustomerSigningSummary | null {
  if (!payment) return null;
  const { setupFeeCents, setupTaxCents, downPaymentCents, totalCents, status, receipt } = payment;
  const result = { setupFeeCents, setupTaxCents, downPaymentCents, totalCents };
  const valid = [setupFeeCents, setupTaxCents, downPaymentCents, totalCents].every(validCents)
    && setupFeeCents + setupTaxCents + downPaymentCents === totalCents;
  if (!valid || !customerId || !(payment.signedAt instanceof Date)
      || !Number.isFinite(payment.signedAt.getTime())) {
    return { setupFeeCents: null, setupTaxCents: null, downPaymentCents: null,
      totalCents: null, status: "REVIEW_REQUIRED", receivedOn: null };
  }
  if (status === "NOT_DUE" && totalCents === 0 && !receipt) {
    return { ...result, status: "NOT_DUE", receivedOn: null };
  }
  if (status === "AWAITING_PAYMENT" && totalCents > 0 && !receipt) {
    return { ...result, status: "AWAITING_PAYMENT", receivedOn: null };
  }
  if (status === "SETTLED" && totalCents > 0 && receipt
      && receipt.customerId === customerId && receipt.amountCents === totalCents
      && receipt.receivedOn instanceof Date
      && Number.isFinite(receipt.receivedOn.getTime())) {
    return { ...result, status: "RECEIVED", receivedOn: receipt.receivedOn };
  }
  // Unknown provider state, stale data and a foreign/wrong-amount receipt
  // can never be translated into "paid" in a customer-facing view.
  return { ...result, status: "REVIEW_REQUIRED", receivedOn: null };
}
