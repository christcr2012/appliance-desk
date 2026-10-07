function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a whole number.`);
  }
}

function addModulo(
  left: number,
  right: number,
  denominator: number,
): { carry: 0 | 1; remainder: number } {
  const gap = denominator - right;
  if (left >= gap) {
    return { carry: 1, remainder: left - gap };
  }
  return { carry: 0, remainder: left + right };
}

function reducedMulDivmod(
  left: number,
  right: number,
  denominator: number,
): { quotient: number; remainder: number } {
  if (left === 0 || right === 0) return { quotient: 0, remainder: 0 };
  if (right === denominator) return { quotient: left, remainder: 0 };

  const half = Math.floor(right / 2);
  const partial = reducedMulDivmod(left, half, denominator);
  const doubled = addModulo(
    partial.remainder,
    partial.remainder,
    denominator,
  );
  let quotient = partial.quotient * 2 + doubled.carry;
  let remainder = doubled.remainder;

  if (right % 2 === 1) {
    const plusLeft = addModulo(remainder, left, denominator);
    quotient += plusLeft.carry;
    remainder = plusLeft.remainder;
  }

  return { quotient, remainder };
}

function exactShare(
  magnitude: number,
  weight: number,
  totalWeight: number,
): { cents: number; remainder: number } {
  if (weight === 0 || magnitude === 0) return { cents: 0, remainder: 0 };

  const whole = Math.floor(magnitude / totalWeight);
  const reduced = magnitude % totalWeight;
  const baseCents = whole * weight;
  const partial = reducedMulDivmod(reduced, weight, totalWeight);
  const cents = baseCents + partial.quotient;

  if (!Number.isSafeInteger(cents)) {
    throw new Error("Allocation exceeds the safe integer range.");
  }
  return { cents, remainder: partial.remainder };
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

  let totalWeight = 0;
  for (const weight of weights) {
    assertSafeInteger(weight, "Weight");
    if (weight < 0) throw new Error("Weights cannot be negative.");
    if (!Number.isSafeInteger(totalWeight + weight)) {
      throw new Error("Total weight exceeds the safe integer range.");
    }
    totalWeight += weight;
  }

  if (weights.length === 0) {
    if (totalCents !== 0) {
      throw new Error("Cannot allocate a non-zero total without any lines.");
    }
    return [];
  }

  if (totalCents === 0) return weights.map(() => 0);
  if (totalWeight === 0) {
    throw new Error(
      "Cannot allocate a non-zero total when every weight is zero.",
    );
  }

  const magnitude = Math.abs(totalCents);
  const shares = weights.map((weight, index) => ({
    index,
    ...exactShare(magnitude, weight, totalWeight),
  }));

  let allocated = shares.reduce((sum, share) => sum + share.cents, 0);
  let remaining = magnitude - allocated;

  const byRemainder = [...shares].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });

  for (const share of byRemainder) {
    if (remaining === 0) break;
    if (share.remainder === 0) continue;
    shares[share.index]!.cents += 1;
    allocated += 1;
    remaining -= 1;
  }

  if (allocated !== magnitude || remaining !== 0) {
    throw new Error("Allocation did not consume the full total.");
  }

  const sign = totalCents < 0 ? -1 : 1;
  return shares.map((share) => share.cents * sign);
}
