// ---------------------------------------------------------------------------
// Churn-risk scoring (2026-09-28, Task #46 of the September 2026 build
// plan — see docs/reviews/2026-09-27-business-growth-ideas.md's idea #5).
// Same "simple, explainable rules only, no AI/ML" approach as lead
// scoring (src/domains/leads/scoring.ts, docs/BUSINESS-RULES.md) — every
// point is paired with a plain-English reason, never a black-box number.
// Pure, no database import — the DB-fetching wrapper is in
// src/domains/growth/index.ts.
// ---------------------------------------------------------------------------

export type ChurnRiskInput = {
  pastDueInvoiceCount: number;
  /** Failed Stripe payment attempts in roughly the last couple of
   * billing cycles — see src/domains/growth/index.ts for the exact
   * window queried. */
  failedPaymentsRecentCount: number;
  /** Days until this agreement's fixed term is due to end (startDate +
   * termMonths), or null for a month-to-month agreement or one with no
   * term recorded. Can be negative if the term has already passed with
   * no renewal or ending recorded. */
  daysUntilTermEnd: number | null;
  /** Maintenance requests opened in roughly the last 90 days. */
  recentMaintenanceRequestCount: number;
};

export type ChurnRiskResult = {
  score: number;
  reasons: string[];
  atRisk: boolean;
};

const AT_RISK_THRESHOLD = 20;
const TERM_ENDING_SOON_DAYS = 30;
const REPEAT_REPAIR_THRESHOLD = 2;

export function computeChurnRisk(input: ChurnRiskInput): ChurnRiskResult {
  const reasons: string[] = [];
  let score = 0;

  if (input.pastDueInvoiceCount > 0) {
    score += 15;
    reasons.push(
      `${input.pastDueInvoiceCount} past-due invoice${input.pastDueInvoiceCount === 1 ? "" : "s"}`,
    );
  }

  if (input.failedPaymentsRecentCount > 0) {
    score += 10;
    reasons.push(
      `${input.failedPaymentsRecentCount} failed payment${input.failedPaymentsRecentCount === 1 ? "" : "s"} recently`,
    );
  }

  if (input.daysUntilTermEnd !== null && input.daysUntilTermEnd <= TERM_ENDING_SOON_DAYS) {
    score += 10;
    reasons.push(
      input.daysUntilTermEnd <= 0
        ? "Term has already ended with no renewal or ending recorded"
        : `Term ends in ${input.daysUntilTermEnd} day${input.daysUntilTermEnd === 1 ? "" : "s"} with no renewal recorded`,
    );
  }

  if (input.recentMaintenanceRequestCount >= REPEAT_REPAIR_THRESHOLD) {
    score += 10;
    reasons.push(
      `${input.recentMaintenanceRequestCount} repair requests in the last 90 days`,
    );
  }

  return { score, reasons, atRisk: score >= AT_RISK_THRESHOLD };
}
