/**
 * Money totals for rental agreements, computed in the domain — never in
 * page code (AGENTS section 4: no financial math in UI). Amounts are
 * integer cents; a non-integer input is a programming error, not a value
 * to round, so it throws instead of silently producing a wrong total.
 */
export function rentalMonthlyTotalCents(
  lines: readonly { monthlyPriceCents: number }[],
): number {
  let total = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.monthlyPriceCents)) {
      throw new Error(
        `monthlyPriceCents must be integer cents, got ${line.monthlyPriceCents}`,
      );
    }
    total += line.monthlyPriceCents;
  }
  return total;
}
