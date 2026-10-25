/**
 * The values each tax policy setting accepts (pure; no database). The save functions in `policy-choices.ts` and the
 * Decisions & reviews registry both check against these lists, and tests/decisions-policy-values.test.ts proves each
 * list equals its Prisma enum (or the documented string values) so they can never drift apart.
 */
export const TAXABILITY_VALUES = ["TAXABLE", "EXEMPT", "UNDECIDED"] as const;
export const LEASE_ELECTION_VALUES = ["UNDECIDED", "PAY_ON_ACQUISITION", "COLLECT_ON_RENTALS"] as const;
export const RDF_HANDLING_VALUES = ["UNDECIDED", "COLLECT_FROM_CUSTOMER", "PAY_MYSELF"] as const;
/** `BusinessSettings.retailDeliveryFeeDecision` (Batch T design: COLLECT only records the answer). */
export const RDF_DECISION_VALUES = ["UNDECIDED", "NOT_LIABLE", "COLLECT"] as const;
export const REPORTING_BASIS_VALUES = ["UNDECIDED", "ACCRUAL", "CASH"] as const;

export type TaxPolicyField = "shortTermLeaseElection" | "rdfHandling" | "retailDeliveryFeeDecision";

export const TAX_POLICY_FIELD_VALUES: Record<TaxPolicyField, readonly string[]> = {
  shortTermLeaseElection: LEASE_ELECTION_VALUES,
  rdfHandling: RDF_HANDLING_VALUES,
  retailDeliveryFeeDecision: RDF_DECISION_VALUES,
};

/** Plain-words problem, or null when the value is one the setting accepts. */
export function taxPolicyValueProblem(field: TaxPolicyField, value: unknown): string | null {
  const allowed = TAX_POLICY_FIELD_VALUES[field];
  if (!allowed) return "Unknown tax setting.";
  return typeof value === "string" && allowed.includes(value) ? null : "That answer isn't one this setting accepts.";
}

export function reportingBasisProblem(value: unknown): string | null {
  return typeof value === "string" && (REPORTING_BASIS_VALUES as readonly string[]).includes(value)
    ? null : "That answer isn't one this setting accepts.";
}

export function taxabilityProblem(value: unknown): string | null {
  return typeof value === "string" && (TAXABILITY_VALUES as readonly string[]).includes(value)
    ? null : "That answer isn't one this setting accepts.";
}
