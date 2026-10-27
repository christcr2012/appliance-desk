import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

export type ConsumerUseTaxFrequency = "ANNUAL" | "MONTHLY";

export type UseTaxFrequencyDecision = {
  frequency: ConsumerUseTaxFrequency;
  effectiveFrom: Date;
};

/**
 * Determine the Colorado consumer use-tax frequency for the year that
 * contains `monthEnd` (TFA-2 §7). Every year starts ANNUAL; the year turns
 * MONTHLY only when that year's own running total passes the limit. There is
 * deliberately no memory of last year here: a total is a running total, so
 * once a year passes the limit it stays passed, and Jan 1 starts clean.
 * Prospective only: callers keep already-filed periods intact.
 */
export function chooseUseTaxFrequency(input: {
  yearDueCents: number;
  thresholdCents: number;
  monthEnd: Date;
}): UseTaxFrequencyDecision {
  if (!Number.isSafeInteger(input.yearDueCents) || input.yearDueCents < 0 ||
      !Number.isSafeInteger(input.thresholdCents) || input.thresholdCents < 0) {
    throw new Error("Use-tax amounts and threshold must be nonnegative integer cents.");
  }
  const monthKey = businessDateKey(input.monthEnd);
  const [year, month, day] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  if (day !== lastDay) throw new Error("Frequency may change only at the end of a calendar month.");

  const next = new Date(Date.UTC(year!, month!, 1));
  const effectiveFrom = businessDateFromKey(next.toISOString().slice(0, 10));
  if (!effectiveFrom) throw new Error("Cannot resolve next Colorado business date.");
  return {
    frequency: input.yearDueCents > input.thresholdCents ? "MONTHLY" : "ANNUAL",
    effectiveFrom,
  };
}
