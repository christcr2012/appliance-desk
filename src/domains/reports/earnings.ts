// ---------------------------------------------------------------------------
// Agreement charge-vs-collection reconciliation.
//
// Both sides intentionally use the same broad invoice basis:
//   expected = invoice charges recorded for the agreement
//   collected = successful Receipt allocations to those invoices - Refunds
//
// This replaced the older 30-day rent-rate proration vs. whole-invoice paid
// projection, which mixed different financial categories and ignored refunds.
// Deposits/tax/fees can appear on both sides only when they are actually part
// of the same invoice basis, so non-rent money can no longer mask a rent-only
// estimate by accident.
// ---------------------------------------------------------------------------

export type AgreementEarningsInput = {
  expectedChargesCents: number;
  netCollectedCents: number;
};

export type AgreementEarnings = {
  expectedChargesCents: number;
  netCollectedCents: number;
  /** Positive means recorded charges exceed net retained collections. */
  gapCents: number;
};

export function computeAgreementEarnings(
  input: AgreementEarningsInput,
): AgreementEarnings {
  if (!Number.isInteger(input.expectedChargesCents) || input.expectedChargesCents < 0) {
    throw new Error("Expected charges must be a non-negative whole number of cents.");
  }
  if (!Number.isInteger(input.netCollectedCents)) {
    throw new Error("Net collected must be a whole number of cents.");
  }

  return {
    expectedChargesCents: input.expectedChargesCents,
    netCollectedCents: input.netCollectedCents,
    gapCents: input.expectedChargesCents - input.netCollectedCents,
  };
}
