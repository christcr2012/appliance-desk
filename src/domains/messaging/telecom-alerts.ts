export type TelecomAlertRules = {
  enabled: boolean; monthlyBudgetCents: number; elevatedCents: number;
  criticalCents: number; spikePercentBasisPoints: number; staleAfterHours: number;
  minimumSpikeCents: number;
};
/** Display-only starting suggestion. IN-53 never auto-approves this policy. */
export const RECOMMENDED_TELECOM_ALERT_RULES: Readonly<TelecomAlertRules> = Object.freeze({
  enabled: false, monthlyBudgetCents: 5000, elevatedCents: 7500,
  criticalCents: 10000, spikePercentBasisPoints: 5000,
  staleAfterHours: 48, minimumSpikeCents: 1000,
});
export type TelecomAlertCandidate =
  "BUDGET_WARNING" | "BUDGET_ELEVATED" | "BUDGET_CRITICAL" |
  "COST_SPIKE" | "USAGE_STALE" | "USAGE_NEVER_SYNCED" |
  "INVOICE_DIFFERENCE" | "UNKNOWN_USAGE_CATEGORY";
export type TelecomAlertPreview = {
  activation: "OFF" | "PROPOSED_ONLY"; evidenceComplete: boolean;
  candidates: TelecomAlertCandidate[]; budgetRemainingCents: number | null;
};
function validRules(v: TelecomAlertRules): boolean {
  return [v.monthlyBudgetCents,v.elevatedCents,v.criticalCents,
    v.spikePercentBasisPoints,v.staleAfterHours,v.minimumSpikeCents]
    .every(n => Number.isSafeInteger(n) && n >= 0) &&
    v.monthlyBudgetCents <= v.elevatedCents &&
    v.elevatedCents <= v.criticalCents &&
    v.spikePercentBasisPoints <= 100000 && v.staleAfterHours > 0 &&
    v.staleAfterHours <= 24*31;
}
/**
 * Proposals only; L13B will connect authorized owner notifications after IN-53.
 * Incomplete/stale source never reports a fresh confirmed spending threshold.
 */
export function previewTelecomCostAlerts(input: {
  rules: TelecomAlertRules; currentCents: number | null;
  currentComplete: boolean; previousCents: number | null;
  previousComplete: boolean; sameLengthWindow: boolean;
  lastUsageSyncAt: Date | null; now: Date;
  invoiceMismatch: boolean | null; unknownCategories: readonly string[];
}): TelecomAlertPreview {
  const { rules, now } = input;
  if (!validRules(rules) || !Number.isFinite(+now)) throw new Error("INVALID_TELECOM_ALERT_RULES");
  const candidates: TelecomAlertCandidate[] = [];
  const stale = !input.lastUsageSyncAt || !Number.isFinite(+input.lastUsageSyncAt) ||
    +now - +input.lastUsageSyncAt > rules.staleAfterHours*3600_000;
  if (!input.lastUsageSyncAt) candidates.push("USAGE_NEVER_SYNCED");
  else if (stale) candidates.push("USAGE_STALE");
  const validCurrent=input.currentCents!==null && Number.isSafeInteger(input.currentCents) &&
    input.currentComplete && !stale;
  if (validCurrent && input.currentCents!==null) {
    if (input.currentCents >= rules.criticalCents) candidates.push("BUDGET_CRITICAL");
    else if (input.currentCents >= rules.elevatedCents) candidates.push("BUDGET_ELEVATED");
    else if (input.currentCents >= rules.monthlyBudgetCents) candidates.push("BUDGET_WARNING");
    if (input.previousComplete && input.sameLengthWindow &&
        input.previousCents!==null && Number.isSafeInteger(input.previousCents) &&
        input.previousCents>=rules.minimumSpikeCents &&
        BigInt(input.currentCents-input.previousCents)*BigInt(10000) >
          BigInt(Math.abs(input.previousCents))*BigInt(rules.spikePercentBasisPoints)) {
      candidates.push("COST_SPIKE");
    }
  }
  if (input.invoiceMismatch===true) candidates.push("INVOICE_DIFFERENCE");
  if (input.unknownCategories.length) candidates.push("UNKNOWN_USAGE_CATEGORY");
  return {
    activation:rules.enabled ? "PROPOSED_ONLY" : "OFF",
    evidenceComplete:validCurrent,
    candidates, budgetRemainingCents:validCurrent && input.currentCents!==null
      ? Math.max(0,rules.monthlyBudgetCents-input.currentCents) : null,
  };
}
