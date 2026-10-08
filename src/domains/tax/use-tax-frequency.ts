import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

export type ConsumerUseTaxFrequency = "ANNUAL" | "MONTHLY";

export type UseTaxFrequencyDecision = {
  frequency: ConsumerUseTaxFrequency;
  effectiveFrom: Date;
};

/**
 * Determine the next Colorado consumer use-tax period frequency.
 * This is a prospective decision only: callers must keep already-filed
 * periods and their assigned tax rows intact.
 */
export function chooseUseTaxFrequency(input: {
  yearDueCents: number;
  thresholdCents: number;
  currentFrequency: ConsumerUseTaxFrequency;
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
    frequency: input.currentFrequency === "MONTHLY" || input.yearDueCents > input.thresholdCents
      ? "MONTHLY" : "ANNUAL",
    effectiveFrom,
  };
}
