export type TaxableLine = {
  amountCents: number;
};

/**
 * Half-up tax rounding per invoice line. `taxRatePermille` is the legacy
 * column/property name, but Batch B now stores thousandths of one percentage
 * point (7375 = 7.375%), so cents × stored-rate is divided by 100,000.
 * Negative adjustment lines keep their sign and are rounded from their
 * absolute value.
 */
export function taxCentsForLine(
  amountCents: number,
  taxRatePermille: number,
): number {
  if (!Number.isInteger(amountCents)) {
    throw new Error("Line amount must be a whole number of cents.");
  }
  if (!Number.isInteger(taxRatePermille) || taxRatePermille < 0) {
    throw new Error(
      "Tax rate must be a non-negative whole thousandth-percent value.",
    );
  }
  const sign = amountCents < 0 ? -1 : 1;
  const absolute = Math.abs(amountCents);
  return sign * Math.floor((absolute * taxRatePermille + 50_000) / 100_000);
}

/** Round each line independently, then sum — never tax an aggregate total. */
export function sumTax(
  lines: readonly TaxableLine[],
  taxRatePermille: number,
): number {
  return lines.reduce(
    (sum, line) => sum + taxCentsForLine(line.amountCents, taxRatePermille),
    0,
  );
}
