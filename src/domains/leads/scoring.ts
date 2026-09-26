/**
 * Lead scoring — simple, explainable rules only (no AI/ML scoring), per
 * docs/BUSINESS-RULES.md. Every point awarded is paired with a
 * human-readable reason so it's never a black box to Chris — the reasons
 * array is stored on the Lead and shown next to it in the desk.
 *
 * Ranking, lowest to highest value (docs/BUSINESS-RULES.md):
 *   month-to-month → 6-month → 12-month → bulk (multiple units) →
 *   landlord/property manager/apartment operator needing multiple units
 */

export type LeadScoringInput = {
  desiredTerm: string | null | undefined; // "month-to-month" | "6-month" | "12-month"
  quantity: number;
  isPropertyManager: boolean;
  isBusiness: boolean;
};

export type LeadScoringResult = {
  score: number;
  reasons: string[];
  isHighValue: boolean;
};

const TERM_POINTS: Record<string, { points: number; reason: string }> = {
  "month-to-month": { points: 0, reason: "Month-to-month term" },
  "6-month": { points: 10, reason: "+ 6-month term" },
  "12-month": { points: 20, reason: "+ 12-month term" },
};

const HIGH_VALUE_THRESHOLD = 30;

export function scoreLead(input: LeadScoringInput): LeadScoringResult {
  const reasons: string[] = [];
  let score = 0;

  const term = input.desiredTerm ?? "month-to-month";
  const termInfo = TERM_POINTS[term];
  if (termInfo) {
    score += termInfo.points;
    reasons.push(termInfo.reason);
  }

  const quantity = Math.max(1, Math.trunc(input.quantity || 1));
  if (quantity > 1) {
    const bulkPoints = 5 * (quantity - 1);
    score += bulkPoints;
    reasons.push(`+ ${quantity} units (bulk)`);
  }

  if (input.isBusiness) {
    score += 10;
    reasons.push("+ business account");
  }

  if (input.isPropertyManager) {
    score += 25;
    reasons.push("+ property manager / landlord / apartment operator");
  }

  const isHighValue = score >= HIGH_VALUE_THRESHOLD;
  if (isHighValue) {
    reasons.push("Flagged high-value");
  }

  return { score, reasons, isHighValue };
}
