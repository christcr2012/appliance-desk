// ---------------------------------------------------------------------------
// Actual vs. estimated earnings (2026-09-28, Task #45 of the September 2026
// build plan) — pure calculation, no database import (same split as
// src/domains/inventory/analytics.ts, src/domains/billing/revenue.ts), so
// it's directly unit-testable; the DB-fetching wrapper lives in
// src/domains/reports/index.ts.
//
// "Estimated" is what an agreement's own agreed pricing entitles Chris to
// bill: a whole price for each billing month counted from the same day each
// month, plus the share of the current month that has passed — not a guess, but a reconstruction from real agreed terms and
// real dates. "Actual" is the rent part of what has actually been collected:
// the money paid on an invoice (Invoice.amountPaidCents, the real
// Stripe-confirmed number) split in proportion to what that invoice is made of,
// so tax, deposits, fees and shop items on the same invoice are not counted
// as rent earned (see rentShareOfPaidCents). The gap
// between them is what this report is for: a signed, billing agreement
// whose actual collections are falling behind its own agreed price is
// worth Chris's attention even before an invoice is formally past due
// (see docs/BUSINESS-RULES.md's "Cross-cutting desk tools... Reports"
// section).
// ---------------------------------------------------------------------------

import { billingPeriodFor } from "@/lib/business-date";

const MAX_MONTHS = 1200; // 100 years: a safety stop, never reached by a real agreement

export type AgreementEarningsInput = {
  billingStartedAt: Date | null;
  endDate: Date | null;
  closedAt: Date | null;
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

/** Pure — what one agreement's pricing entitles Chris to bill, following the way billing really works: a full
 * monthly price for every whole billing month counted from the same day each month (BUSINESS-RULES: "same day each
 * month"; a Jan 31 start bills Feb 28, Mar 31, Apr 30), plus the share of the current month that has passed. A
 * 31-day month and a 28-day month are each one month, not 31/30 and 28/30 of one. An agreement that never started
 * billing (billingStartedAt is null) contributes $0, never a guessed number. */
export function computeEstimatedEarningsCents(
  agreement: {
    billingStartedAt: Date | null;
    endDate: Date | null;
    closedAt: Date | null;
    lines: { monthlyPriceCents: number }[];
  },
  asOf: Date,
): number {
  if (!agreement.billingStartedAt) {
    return 0;
  }
  let end = asOf;
  if (agreement.endDate && agreement.endDate < end) end = agreement.endDate;
  if (agreement.closedAt && agreement.closedAt < end) end = agreement.closedAt;
  if (end.getTime() <= agreement.billingStartedAt.getTime()) return 0;
  const monthlyTotalCents = agreement.lines.reduce((sum, line) => sum + line.monthlyPriceCents, 0);
  let wholeMonths = 0;
  while (wholeMonths < MAX_MONTHS && billingPeriodFor(agreement.billingStartedAt, wholeMonths).end.getTime() <= end.getTime()) {
    wholeMonths += 1;
  }
  const current = billingPeriodFor(agreement.billingStartedAt, wholeMonths);
  const share = Math.max(0, (end.getTime() - current.start.getTime()) / (current.end.getTime() - current.start.getTime()));
  return Math.round(monthlyTotalCents * (wholeMonths + share));
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

/** Invoice lines that count as rent: the monthly rent, rent for days kept past the end date (and its waiver) and
 * the prepay discount that reduces rent. Everything else (setup and delivery fees, deposits, tax, late-payment
 * fees, shop items, used appliances, credits) is not rent earned. */
const RENT_KINDS = new Set(["RENTAL", "LATE_RETURN", "LATE_RETURN_WAIVER", "PREPAY_DISCOUNT"]);

export type InvoiceForEarnings = {
  amountPaidCents: number;
  /** What the invoice asked for in total (rent, tax, fees ...). */
  amountDueCents: number;
  lineItems: { kind: string; amountCents: number }[];
  refundedCents: number;
};

/** Pure — the rent part of what one invoice has really collected, net of refunds. The money paid (less refunds) is
 * split in proportion to how much of the invoice total is rent, because a payment is not tied to a line. An invoice
 * with nothing due, or no rent on it, contributes $0; the rent part never exceeds what was paid. */
export function rentShareOfPaidCents(invoice: InvoiceForEarnings): number {
  const netPaid = invoice.amountPaidCents - invoice.refundedCents;
  if (netPaid <= 0 || invoice.amountDueCents <= 0) return 0;
  const rent = invoice.lineItems.filter((l) => RENT_KINDS.has(l.kind)).reduce((sum, l) => sum + l.amountCents, 0);
  if (rent <= 0) return 0;
  const share = Math.min(1, rent / invoice.amountDueCents);
  return Math.min(netPaid, Math.round(netPaid * share));
}
