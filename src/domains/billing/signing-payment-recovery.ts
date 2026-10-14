export type SigningRecoveryInput = {
  obligationStatus: string;
  totalCents: number;
  receiptVerified: boolean;
  fingerprint: string;
  latestAttempt?: { method: string; status: string; amountCents: number; orderFingerprint: string } | null;
};

export type SigningRecoveryAdvice = {
  heading: string;
  explanation: string;
  canRecordManual: boolean;
  providerReconciliationRequired: boolean;
};

/**
 * An uncertain provider outcome can never initiate a second collection.
 * Owner views and the durable attempt reservation enforce this separately.
 */
export function signingPaymentRecoveryAdvice(input: SigningRecoveryInput): SigningRecoveryAdvice {
  const blocked = (heading: string, explanation: string, providerReconciliationRequired = false): SigningRecoveryAdvice =>
    ({ heading, explanation, canRecordManual: false, providerReconciliationRequired });
  if (!Number.isSafeInteger(input.totalCents) || input.totalCents < 0 ||
      !/^[a-f0-9]{64}$/.test(input.fingerprint)) {
    return blocked("Signing payment needs review",
      "The signed obligation is inconsistent. Do not collect or record another payment.");
  }
  if (input.obligationStatus === "NOT_DUE" && input.totalCents === 0) {
    return blocked("No signing amount due", "This signed order has a verified zero signing amount.");
  }
  if (input.obligationStatus === "SETTLED") {
    return input.receiptVerified
      ? blocked("Signing money verified", "The receipt belongs to this signed amount. First-invoice credit is verified separately.")
      : blocked("Recorded payment needs investigation",
          "The settlement does not match the exact signed customer amount. Investigate before dispatch or further collection.", true);
  }
  if (input.obligationStatus !== "AWAITING_PAYMENT" || input.totalCents === 0) {
    return blocked("Signing payment needs review", "Do not request or record money until the obligation is reconciled.");
  }
  const attempt = input.latestAttempt;
  if (attempt && (attempt.amountCents !== input.totalCents ||
      attempt.orderFingerprint !== input.fingerprint)) {
    return blocked("Payment attempt does not match signed order",
      "A previous collection attempt used different frozen terms. Investigate before another payment.",true);
  }
  if (attempt?.status === "UNKNOWN" || attempt?.status === "SUCCEEDED") {
    return blocked("Reconcile uncertain signing payment",
      "The provider outcome is not reconciled against a valid receipt. Check the provider-authoritative result before any retry or manual record.",true);
  }
  if (attempt?.status === "PENDING") {
    return blocked("Signing payment pending verification",
      "Wait for authoritative provider settlement or failure. Do not attempt a second charge or record a manual payment.",true);
  }
  if (attempt?.status === "PREPARED" && attempt.method === "STRIPE_CHECKOUT") {
    return blocked("Existing secure checkout attempt",
      "A secure checkout attempt already exists. Verify its provider state before switching payment methods or starting another collection.",true);
  }
  if (attempt && !["FAILED","PREPARED"].includes(attempt.status)) {
    return blocked("Unrecognized payment state",
      "An unsupported collection state requires owner and provider reconciliation before another payment.",true);
  }
  if (attempt?.status === "FAILED") {
    return { heading:"Previous payment failed",canRecordManual:true,providerReconciliationRequired:false,
      explanation:"Confirm the provider's final failure before retrying. If full offline money was actually received, an owner may record its unique verified receipt. Never mark a failed attempt paid." };
  }
  return { heading:"Signing amount awaiting collection",canRecordManual:true,providerReconciliationRequired:false,
    explanation:"The signed amount is unpaid. An owner may record a verified full offline payment; checking this screen does not create or settle a charge." };
}
