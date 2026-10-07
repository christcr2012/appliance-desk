function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(\`\${label} must be a whole number.\`);
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
    0n,
  );
  if (totalWeight === 0n) {
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

  let allocated = shares.reduce((sum, share) => sum + share.cents, 0n);
  let remaining = magnitude - allocated;

  const byRemainder = [...shares].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });

  for (const share of byRemainder) {
    if (remaining === 0n) break;
    if (share.remainder === 0n) continue;
    shares[share.index]!.cents += 1n;
    allocated += 1n;
    remaining -= 1n;
  }

  if (allocated !== magnitude || remaining !== 0n) {
    throw new Error("Allocation did not consume the full total.");
  }

  const sign = totalCents < 0 ? -1 : 1;
  return shares.map((share) => Number(share.cents) * sign);
}
