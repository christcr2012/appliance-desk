import type { FrozenSigningEvidence } from "./signing-frozen-evidence";

/** One durable payment *obligation*, not a charge, receipt, deposit or credit. */
export function signedPaymentObligation(
  line: FrozenSigningEvidence,
  signedAt: Date,
) {
  const values = [line.setupFeeCents, line.setupTaxCents,
    line.downPaymentCents, line.allInCents];
  if (![1,2].includes(line.schemaVersion) || !line.agreementId ||
      !/^[a-f0-9]{64}$/.test(line.orderFingerprint) ||
      !values.every(n => Number.isSafeInteger(n) && n >= 0) ||
      !Number.isSafeInteger(line.setupFeeCents + line.setupTaxCents + line.downPaymentCents) ||
      (line.schemaVersion === 1 &&
        line.setupFeeCents + line.setupTaxCents + line.downPaymentCents !== line.allInCents) ||
      !(signedAt instanceof Date) || Number.isNaN(signedAt.getTime())) {
    throw new Error("Signing obligation requires reconciled immutable accepted evidence.");
  }
  return {
    agreementId: line.agreementId,
    orderFingerprint: line.orderFingerprint,
    evidenceVersion: line.schemaVersion,
    setupFeeCents: line.setupFeeCents,
    setupTaxCents: line.setupTaxCents,
    downPaymentCents: line.downPaymentCents,
    totalCents: line.allInCents,
    ...(line.schemaVersion === 2 ? { componentEvidence: JSON.parse(JSON.stringify(line.v2Extension)) } : {}),
    status: line.allInCents === 0 ? "NOT_DUE" : "AWAITING_PAYMENT",
    signedAt,
  } as const;
}
