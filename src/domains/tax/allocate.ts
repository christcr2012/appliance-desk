function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a whole number.`);
  }
}

/**
 * Allocate an integer-cent total proportionally with the largest-remainder
 * method. Ties go to the earlier weight, and negative totals are the exact
 * sign-reversed allocation of the equivalent positive total.
 */
export function allocateAcrossLines(
  totalCents: number,
  weights: readonly number[],
): number[] {
  assertSafeInteger(totalCents, "Total");
  for (const weight of weights) {
    assertSafeInteger(weight, "Weight");
    if (weight < 0) throw new Error("Weights cannot be negative.");
  }

  if (weights.length === 0) {
    if (totalCents !== 0) {
      throw new Error("Cannot allocate a non-zero total without any lines.");
    }
    return [];
  }

  if (totalCents === 0) return weights.map(() => 0);

  const totalWeight = weights.reduce(
    (sum, weight) => sum + BigInt(weight),
    BigInt(0),
  );
  if (totalWeight === BigInt(0)) {
    throw new Error("Cannot allocate a non-zero total when every weight is zero.");
  }

  const magnitude = BigInt(Math.abs(totalCents));
  const shares = weights.map((weight, index) => {
    const numerator = magnitude * BigInt(weight);
    return {
      index,
      cents: numerator / totalWeight,
      remainder: numerator % totalWeight,
    };
  });

  let allocated = shares.reduce((sum, share) => sum + share.cents, BigInt(0));
  let remaining = magnitude - allocated;

  const byRemainder = [...shares].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });

  for (const share of byRemainder) {
    if (remaining === BigInt(0)) break;
    if (share.remainder === BigInt(0)) continue;
    shares[share.index]!.cents += BigInt(1);
    allocated += BigInt(1);
    remaining -= BigInt(1);
  }

  if (allocated !== magnitude || remaining !== BigInt(0)) {
    throw new Error("Allocation did not consume the full total.");
  }

  const sign = totalCents < 0 ? -1 : 1;
  return shares.map((share) => Number(share.cents) * sign);
}
