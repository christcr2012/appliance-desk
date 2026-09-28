// ---------------------------------------------------------------------------
// Fleet utilization + appliance profitability/ROI — pure calculations only
// (no `@/lib/prisma` import here), so these are directly unit-testable
// (see tests/inventory-analytics.test.ts) the same way
// canTransitionApplianceStatus and isReservationStale are. The DB-fetching
// wrappers that call these live in src/domains/inventory/index.ts.
//
// Added 2026-09-27 in response to a friend's "complete rebuild" proposal
// (docs/reviews/2026-09-27-friend-full-rebuild-proposal.md) — Chris asked
// for appliance profitability/ROI and fleet utilization specifically. See
// docs/DECISIONS.md for the approach and its known limits.
// ---------------------------------------------------------------------------

export type AssignmentPeriod = {
  assignedAt: Date;
  unassignedAt: Date | null;
  /** The rental line's agreed monthly price (already net of any prepaid
   * discount — see RentalLine.monthlyPriceCents). */
  monthlyPriceCents: number;
  /** How many appliances shared this same rental line (e.g. 2 for a
   * washer+dryer "set" line) — revenue is split evenly across them, since
   * the line's price was never broken out per-appliance at signing. */
  applianceCountOnLine: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** A month is approximated as 30 days for revenue proration — matches the
 * granularity everything else in this app's billing already works in
 * (monthly rent), and is close enough for an ROI estimate rather than an
 * invoice (which is always the real, exact amount actually billed). */
const DAYS_PER_MONTH = 30;

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / MS_PER_DAY);
}

/** Revenue attributed to one assignment period: the rental line's monthly
 * price, split evenly across however many appliances were on that line,
 * prorated for the number of days this specific appliance was actually
 * assigned to it (from assignedAt to unassignedAt, or to `asOf` if it's
 * still assigned today). This is an estimate from agreed pricing and real
 * assignment dates — not a substitute for the exact amounts actually
 * invoiced/collected (see docs/DECISIONS.md for why it's built this way). */
export function computeAssignmentRevenueCents(
  period: AssignmentPeriod,
  asOf: Date,
): number {
  const end = period.unassignedAt ?? asOf;
  const days = daysBetween(period.assignedAt, end);
  const perApplianceMonthlyCents =
    period.monthlyPriceCents / Math.max(1, period.applianceCountOnLine);
  return Math.round((perApplianceMonthlyCents / DAYS_PER_MONTH) * days);
}

/** Sums computeAssignmentRevenueCents across every assignment period an
 * appliance has ever had (it can be rented, returned, and rented again). */
export function computeApplianceRevenueCents(
  periods: AssignmentPeriod[],
  asOf: Date,
): number {
  return periods.reduce(
    (sum, period) => sum + computeAssignmentRevenueCents(period, asOf),
    0,
  );
}

/** What fraction of an appliance's time in the fleet (since it was added,
 * through `asOf`) it has actually been assigned to a customer, 0–1. This is
 * "utilization" in the fleet-analytics sense: an appliance sitting
 * AVAILABLE or in MAINTENANCE counts against it the same as one that's
 * RETIRED-but-not-marked-so — only actual assignment time counts. */
export function computeUtilizationFraction(
  periods: { assignedAt: Date; unassignedAt: Date | null }[],
  inServiceSince: Date,
  asOf: Date,
): number {
  const totalDays = daysBetween(inServiceSince, asOf);
  if (totalDays <= 0) {
    return 0;
  }
  const assignedDays = periods.reduce((sum, period) => {
    const start = period.assignedAt < inServiceSince ? inServiceSince : period.assignedAt;
    const end = period.unassignedAt ?? asOf;
    return sum + daysBetween(start, end);
  }, 0);
  return Math.min(1, assignedDays / totalDays);
}

/** Sums a set of completed repair jobs' recorded parts + labor cost. A job
 * with no cost entered yet (Chris hasn't logged it, or it wasn't a paid
 * repair) contributes $0 — never a guessed number. */
export function computeRepairCostCents(
  jobs: { partsCostCents: number | null; laborCostCents: number | null }[],
): number {
  return jobs.reduce(
    (sum, job) => sum + (job.partsCostCents ?? 0) + (job.laborCostCents ?? 0),
    0,
  );
}

export type ProfitabilitySummary = {
  revenueCents: number;
  repairCostCents: number;
  acquisitionCostCents: number;
  /** revenueCents - repairCostCents - acquisitionCostCents — matches the
   * "Net Contribution" figure in the proposal's worked example. */
  netContributionCents: number;
  /** Whether rental revenue collected so far (net of repair costs) has
   * covered what the appliance cost to buy — the proposal's "date the
   * appliance paid for itself" idea, as a yes/no rather than a projected
   * date, since projecting a future date from a variable monthly amount
   * would be a guess dressed up as a fact. */
  paidForItself: boolean;
};

export function computeProfitability(input: {
  revenueCents: number;
  repairCostCents: number;
  acquisitionCostCents: number | null;
}): ProfitabilitySummary {
  const acquisitionCostCents = input.acquisitionCostCents ?? 0;
  const netOfRepairs = input.revenueCents - input.repairCostCents;
  return {
    revenueCents: input.revenueCents,
    repairCostCents: input.repairCostCents,
    acquisitionCostCents,
    netContributionCents: netOfRepairs - acquisitionCostCents,
    paidForItself: netOfRepairs >= acquisitionCostCents,
  };
}
