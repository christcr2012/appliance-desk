import {
  businessDateEnd,
  businessDateFromKey,
  businessDateKey,
} from "@/lib/business-date";

/**
 * R09 — when an estimate stops being answerable.
 *
 * `Estimate.validUntil` means "good through the end of this Colorado calendar
 * day". An estimate is expired from the first instant of the NEXT Colorado day.
 *
 * New rows store the last second of that Colorado day. Older rows were stored by
 * `new Date("YYYY-MM-DD")`, which is exactly midnight UTC and, read in Colorado
 * time, falls on the PREVIOUS evening. A value that is exactly midnight UTC is
 * therefore read as the calendar date it was typed as.
 */
export function estimateValidThroughKey(validUntil: Date): string {
  const isLegacyUtcMidnight = validUntil.getTime() % 86_400_000 === 0;
  return isLegacyUtcMidnight
    ? validUntil.toISOString().slice(0, 10)
    : businessDateKey(validUntil);
}

/** The first instant at which the estimate can no longer be answered. */
export function estimateExpiresAt(validUntil: Date): Date {
  return new Date(
    businessDateEnd(estimateValidThroughKey(validUntil)).getTime() + 1000,
  );
}

export function isEstimatePastValidity(
  validUntil: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!validUntil) return false;
  return now.getTime() >= estimateExpiresAt(validUntil).getTime();
}

/**
 * Read the "valid until" box of a desk form. Blank means "no deadline". Anything
 * that is not a real calendar date (`2026-02-30`, `10/05/2026`, `tomorrow`) is
 * rejected instead of being guessed at.
 */
export function parseEstimateValidUntil(
  value: string | undefined,
): { ok: true; value: Date | null } | { ok: false } {
  const text = (value ?? "").trim();
  if (!text) return { ok: true, value: null };
  if (!businessDateFromKey(text)) return { ok: false };
  return { ok: true, value: businessDateEnd(text) };
}

export const INVALID_VALID_UNTIL_MESSAGE =
  "Enter the “valid until” date as a real calendar date, or leave it blank.";
