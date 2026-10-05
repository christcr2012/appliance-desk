import type { LeadScoringPolicy } from "./scoring-policy";

/**
 * Lead scoring — simple, explainable rules only (no AI/ML scoring), per
 * docs/BUSINESS-RULES.md. Every point awarded is paired with a
 * human-readable reason so it is never a black box. The policy is supplied
 * by the caller so saved scores are tied to an explicit policy version.
 */
export type LeadScoringInput = {
  desiredTerm: string | null | undefined;
  quantity: number;
  isPropertyManager: boolean;
  isBusiness: boolean;
};

export type LeadScoringResult = {
  score: number;
  reasons: string[];
  isHighValue: boolean;
};

const TERM_REASONS: Record<string, string> = {
  "month-to-month": "Month-to-month term",
  "6-month": "+ 6-month term",
  "12-month": "+ 12-month term",
};

export function scoreLead(
  input: LeadScoringInput,
  policy: LeadScoringPolicy,
): LeadScoringResult {
  const reasons: string[] = [];
  let score = 0;

  const term = input.desiredTerm ?? "month-to-month";
  const termPoints = policy.termPoints[term as keyof LeadScoringPolicy["termPoints"]];
  if (termPoints !== undefined) {
    score += termPoints;
    reasons.push(TERM_REASONS[term] ?? `${term} term`);
  }

  const quantity = Math.max(1, Math.trunc(input.quantity || 1));
  if (quantity > 1) {
    score += policy.additionalUnitPoints * (quantity - 1);
    reasons.push(`+ ${quantity} units (bulk)`);
  }

  if (input.isBusiness) {
    score += policy.businessAccountPoints;
    reasons.push("+ business account");
  }

  if (input.isPropertyManager && quantity > 1) {
    score += policy.multiUnitPropertyManagerPoints;
    reasons.push("+ property manager / landlord / apartment operator");
  }

  const isHighValue = score >= policy.highValueThreshold;
  if (isHighValue) reasons.push("Flagged high-value");

  return { score, reasons, isHighValue };
}
