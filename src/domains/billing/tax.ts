/**
 * Sales-tax arithmetic. Money is integer cents; tax rates are integer
 * MILLI-PERCENT: thousandths of one percent, so 7.375% is 7375 and 7.3% is
 * 7300 (owner decision IN-17, 2026-10-02: rates to 0.001 percentage point).
 *
 * Rounding rule (documented in BUSINESS-RULES.md, "Ledger"): tax is computed
 * PER LINE and rounded half away from zero to the nearest cent, then the
 * rounded line amounts are summed. The sum of rounded lines is the invoice
 * tax; it can differ by a cent or two from taxing the invoice subtotal once.
 * All arithmetic is integer, so there is no floating-point drift.
 */

const MILLI_PERCENT_DENOMINATOR = 100_000; // 100 (percent) * 1000 (thousandths)
export const MAX_TAX_RATE_MILLI_PERCENT = 100_000; // 100%

function assertWholeNumber(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a whole number.`);
  }
}

/** Existing `taxRatePermille` values are tenths of a percent (73 = 7.3%). This converts them to milli-percent exactly (73 -> 7300). */
export function permilleToMilliPercent(taxRatePermille: number): number {
  assertWholeNumber(taxRatePermille, "Tax rate");
  return taxRatePermille * 100;
}

/** Tax for one line, in cents, rounded half away from zero. Negative lines (discounts, credits) round symmetrically. */
export function taxCentsForLine(amountCents: number, taxRateMilliPercent: number): number {
  assertWholeNumber(amountCents, "Line amount");
  assertWholeNumber(taxRateMilliPercent, "Tax rate");
  if (taxRateMilliPercent < 0 || taxRateMilliPercent > MAX_TAX_RATE_MILLI_PERCENT) {
    throw new Error("Tax rate must be between 0% and 100%.");
  }
  const sign = amountCents < 0 ? -1 : 1;
  const exactNumerator = Math.abs(amountCents) * taxRateMilliPercent;
  const rounded = Math.floor(
    (2 * exactNumerator + MILLI_PERCENT_DENOMINATOR) / (2 * MILLI_PERCENT_DENOMINATOR),
  );
  return sign * rounded;
}

/** Invoice tax: each line is taxed and rounded on its own, then summed. Lines may be plain cent amounts or objects with `amountCents`. */
export function sumTax(
  lines: ReadonlyArray<number | { amountCents: number }>,
  taxRateMilliPercent: number,
): number {
  let total = 0;
  for (const line of lines) {
    const amountCents = typeof line === "number" ? line : line.amountCents;
    total += taxCentsForLine(amountCents, taxRateMilliPercent);
  }
  return total;
}

/** Owner-facing text for a rate, e.g. 7375 -> "7.375%", 7300 -> "7.3%", 0 -> "0%". Trailing zeros are dropped. */
export function formatTaxRate(taxRateMilliPercent: number): string {
  assertWholeNumber(taxRateMilliPercent, "Tax rate");
  const whole = Math.trunc(taxRateMilliPercent / 1000);
  const fraction = String(Math.abs(taxRateMilliPercent % 1000)).padStart(3, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}%`;
}

/**
 * Parse owner-typed percent text ("7.375", "7.375%", " 8 ") into milli-percent.
 * Accepts at most three decimal places; anything finer is rejected rather than
 * silently rounded, because the owner asked for exact storage.
 */
export function parseTaxRatePercent(text: string): number {
  const match = /^\s*(\d{1,3})(?:\.(\d{1,3}))?\s*%?\s*$/.exec(text);
  if (!match) {
    throw new Error("Enter the tax rate as a percentage with up to three decimal places, such as 7.375.");
  }
  const milli = Number(match[1]) * 1000 + Number((match[2] ?? "").padEnd(3, "0"));
  if (milli > MAX_TAX_RATE_MILLI_PERCENT) {
    throw new Error("Tax rate must be between 0% and 100%.");
  }
  return milli;
}

