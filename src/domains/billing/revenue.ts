// ---------------------------------------------------------------------------
// MRR/ARR financial dashboard (2026-09-27) — see docs/DECISIONS.md for how
// this fits with what already existed (Stripe billing, per-invoice views)
// and its known approximations. Added in response to a friend's rebuild
// proposal (docs/reviews/2026-09-27-friend-full-rebuild-proposal.md);
// Chris asked for this one specifically.
// ---------------------------------------------------------------------------

export type MrrTrendPoint = { monthLabel: string; mrrCents: number };

/**
 * Pure: reconstructs Monthly Recurring Revenue for each of the trailing
 * `monthsBack` months (oldest first) from agreements' own
 * startDate/endDate and their rental lines' agreed monthly price.
 *
 * This is an approximation, not a ledger: RentalLine.monthlyPriceCents is
 * frozen at signing and never edited afterward (docs/BUSINESS-RULES.md),
 * so reconstructing a past month's MRR from today's line prices is
 * accurate for any agreement that hasn't changed since — which is every
 * agreement, since this app has no "edit an active agreement's price"
 * feature. What it can't see: an agreement cancelled and later re-signed
 * under a different id would show as two separate gaps rather than one
 * continuous customer relationship — an acceptable simplification for a
 * trend line, not for a legal/financial record (which is what the real
 * Invoice/Payment tables are for).
 */
export function computeMrrTrend(
  agreements: {
    startDate: Date | null;
    endDate: Date | null;
    lines: { monthlyPriceCents: number }[];
  }[],
  monthsBack: number,
  asOf: Date,
): MrrTrendPoint[] {
  const points: MrrTrendPoint[] = [];

  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    // UTC on purpose, not `new Date(year, month, 1)` (which constructs in
    // whatever timezone the server process happens to be running in):
    // agreement.startDate/endDate come out of Postgres as real UTC
    // instants, so comparing against a boundary built in a different
    // timezone can be off by several hours — enough to misclassify which
    // month a start/end date falls into right at a month boundary. Using
    // Date.UTC for both sides of every comparison keeps this correct no
    // matter what timezone this code actually runs in.
    const monthStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - i, 1));
    const nextMonthStart = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - i + 1, 1),
    );

    const mrrCents = agreements.reduce((sum, agreement) => {
      if (!agreement.startDate || agreement.startDate >= nextMonthStart) {
        return sum; // hadn't started yet as of this month
      }
      if (agreement.endDate && agreement.endDate < monthStart) {
        return sum; // already ended before this month began
      }
      const lineTotal = agreement.lines.reduce(
        (lineSum, line) => lineSum + line.monthlyPriceCents,
        0,
      );
      return sum + lineTotal;
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
