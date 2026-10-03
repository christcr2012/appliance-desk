import { businessMonthBounds } from "@/lib/business-date";

// ---------------------------------------------------------------------------
// MRR/ARR financial dashboard — agreement-rate metrics, intentionally
// separate from the cash ledger. Cash readers use Receipt/Refund records.
// ---------------------------------------------------------------------------

export type MrrTrendPoint = { monthLabel: string; mrrCents: number };

export function computeMrrTrend(
  agreements: {
    billingStartedAt: Date | null;
    endDate: Date | null;
    lines: { monthlyPriceCents: number }[];
  }[],
  monthsBack: number,
  asOf: Date,
): MrrTrendPoint[] {
  const points: MrrTrendPoint[] = [];

  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const monthStart = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - i, 1),
    );
    const nextMonthStart = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - i + 1, 1),
    );

    const mrrCents = agreements.reduce((sum, agreement) => {
      if (
        !agreement.billingStartedAt ||
        agreement.billingStartedAt >= nextMonthStart ||
        agreement.billingStartedAt > asOf
      ) {
        return sum;
      }
      if (agreement.endDate && agreement.endDate <= monthStart) return sum;
      return (
        sum +
        agreement.lines.reduce(
          (lineSum, line) => lineSum + line.monthlyPriceCents,
          0,
        )
      );
    }, 0);

    points.push({
      monthLabel: monthStart.toLocaleString("en-US", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      }),
      mrrCents,
    });
  }

  return points;
}

/**
 * Timestamp predicate for owner-facing period views. "This month" follows
 * the Colorado business calendar instead of the server/UTC month. All-time
 * still excludes future-dated records relative to the supplied snapshot.
 */
export function revenuePeriod(asOf: Date, monthOnly: boolean) {
  if (!Number.isFinite(asOf.getTime())) throw new Error("Invalid revenue snapshot time.");
  if (!monthOnly) return { lte: asOf };
  const month = businessMonthBounds(asOf);
  return { gte: month.start, lte: asOf };
}
