export type TaxableLine = {
  amountCents: number;
};

/**
 * Half-up tax rounding per invoice line. `taxRatePermille` stores tenths of a
 * percent (73 = 7.3%), so the divisor is 1000. Negative adjustment lines keep
 * their sign and are rounded from their absolute value.
 */
export function taxCentsForLine(
  amountCents: number,
  taxRatePermille: number,
): number {
  if (!Number.isInteger(amountCents)) {
    throw new Error("Line amount must be a whole number of cents.");
  }
  if (!Number.isInteger(taxRatePermille) || taxRatePermille < 0) {
    throw new Error("Tax rate must be a non-negative whole permille value.");
  }
  const sign = amountCents < 0 ? -1 : 1;
  const absolute = Math.abs(amountCents);
  return sign * Math.floor((absolute * taxRatePermille + 500) / 1000);
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
