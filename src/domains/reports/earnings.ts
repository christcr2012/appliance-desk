// ---------------------------------------------------------------------------
// Actual vs. estimated earnings (2026-09-28, Task #45 of the September 2026
// build plan) — pure calculation, no database import (same split as
// src/domains/inventory/analytics.ts, src/domains/billing/revenue.ts), so
// it's directly unit-testable; the DB-fetching wrapper lives in
// src/domains/reports/index.ts.
//
// "Estimated" is what an agreement's own agreed pricing entitles Chris to
// bill, prorated for the time it's actually been billing (same
// days/30-per-month convention as computeAssignmentRevenueCents and
// computeMrrTrend, for consistency with the rest of the app's revenue
// math) — not a guess, but a reconstruction from real agreed terms and
// real dates. "Actual" is what has actually been collected, straight from
// Invoice.amountPaidCents (the real Stripe-confirmed number). The gap
// between them is what this report is for: a signed, billing agreement
// whose actual collections are falling behind its own agreed price is
// worth Chris's attention even before an invoice is formally past due
// (see docs/BUSINESS-RULES.md's "Cross-cutting desk tools... Reports"
// section).
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30;

export type AgreementEarningsInput = {
  billingStartedAt: Date | null;
  endDate: Date | null;
  lines: { monthlyPriceCents: number }[];
  invoicePaidCents: number;
};

export type AgreementEarnings = {
  estimatedCents: number;
  actualCents: number;
  /** estimatedCents - actualCents. Positive means collections are behind
   * what's been agreed to; negative (rare — a discount applied after the
   * fact, a partial refund not reflected here) is never treated as a
   * warning. */
  gapCents: number;
};

/** Pure — what one agreement's pricing entitles Chris to bill, prorated
 * for the time it's actually been in its billing period. An agreement
 * that never started billing (billingStartedAt is null) contributes $0,
 * never a guessed number. */
export function computeEstimatedEarningsCents(
  agreement: { billingStartedAt: Date | null; endDate: Date | null; lines: { monthlyPriceCents: number }[] },
  asOf: Date,
): number {
  if (!agreement.billingStartedAt) {
    return 0;
  }
  const end = agreement.endDate && agreement.endDate < asOf ? agreement.endDate : asOf;
  const days = Math.max(0, (end.getTime() - agreement.billingStartedAt.getTime()) / MS_PER_DAY);
  const monthlyTotalCents = agreement.lines.reduce((sum, line) => sum + line.monthlyPriceCents, 0);
  return Math.round((monthlyTotalCents / DAYS_PER_MONTH) * days);
}

/** Pure — pairs the estimated figure above with what was actually
 * collected, for one agreement. */
export function computeAgreementEarnings(
  agreement: AgreementEarningsInput,
  asOf: Date,
): AgreementEarnings {
  const estimatedCents = computeEstimatedEarningsCents(agreement, asOf);
  const actualCents = agreement.invoicePaidCents;
  return {
    estimatedCents,
    actualCents,
    gapCents: estimatedCents - actualCents,
  };
}
