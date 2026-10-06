import { requireRole } from "@/lib/session";
import Link from "next/link";
import {
  getFleetAnalytics,
  getApplianceCountsByStatus,
} from "@/domains/inventory";
import { formatCents } from "@/domains/pricing";
import { fleetReportPage } from "@/domains/inventory/fleet-report";
import {
  PageHeader,
  SectionCard,
  EmptyState,
} from "@/components/desk/workspace";
import { Pagination } from "@/components/pagination";
import { MetricStat } from "@/components/desk/metric-stat";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";

export const metadata = { title: "Fleet" };

export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; costs?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const query = await searchParams;
  const missingOnly = query.costs === "missing";
  const [{ appliances, totals, asOf }, statusCounts] = await Promise.all([
    getFleetAnalytics(),
    getApplianceCountsByStatus(),
  ]);

  const records = fleetReportPage(appliances, query.page, missingOnly);
  const recordsHref = (page = 1, missing = missingOnly) =>
    `/desk/fleet?${new URLSearchParams({ costs: missing ? "missing" : "all", page: String(page) })}`;

  const byUtilization = [...appliances].sort(
    (a, b) => b.utilizationFraction - a.utilizationFraction,
  );
  const mostUtilized = byUtilization.slice(0, 5);
  const leastUtilized = [...byUtilization].reverse().slice(0, 5);
  const highestRepairCost = [...appliances]
    .filter((a) => a.repairCostCents > 0)
    .sort((a, b) => b.repairCostCents - a.repairCostCents)
    .slice(0, 5);

  return (
    <div>
      <PageHeader
        title="Fleet and appliance estimates"
        description="Assignment-based rental value, recorded costs and the appliance records behind them."
      />
      <SectionCard title="How to read these estimates">
        <p className="text-sm text-ink-soft">
          As of {formatBusinessDate(asOf)} at {formatBusinessTime(asOf)}.
          Includes all non-archived appliances, including retired units still on
          file. Utilization is assigned time since each unit was added, not the
          percentage of units rented today.
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          Rental value uses agreed monthly prices, 30-day proration and
          assignment dates; a rental line is split across its distinct assigned
          units. It is not invoiced or collected revenue. Recorded repair cost
          is the parts plus labor entered on completed maintenance visits; a
          shared job&apos;s full entered cost appears on each linked unit.
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          Contribution subtracts recorded acquisition and repair costs. Blank
          costs contribute no recorded amount and remain incomplete. Deposits,
          refunds, overdue invoices, operating overhead and taxes are not
          apportioned here, so these figures do not establish cash collected or
          business profit.
        </p>
        <Link
          href="/desk/revenue"
          className="mt-3 inline-block text-sm underline"
        >
          Review recorded payments and refunds
        </Link>
      </SectionCard>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricStat metric="fleet.applianceCount" value={String(totals.applianceCount)} />
        <MetricStat metric="fleet.utilization"
          value={`${Math.round(totals.averageUtilizationFraction * 100)}%`}
        />
        <MetricStat metric="fleet.rented" value={String(statusCounts.RENTED)} />
        <MetricStat metric="fleet.available"
          value={String(statusCounts.AVAILABLE)}
        />
        <MetricStat metric="fleet.maintenance" value={String(statusCounts.MAINTENANCE)} />
        <MetricStat metric="fleet.acquisitionCost"
          value={formatCents(totals.totalInvestedCents)}
        />
        <MetricStat metric="fleet.rentalValue"
          value={formatCents(totals.totalRevenueCents)}
        />
        <MetricStat metric="fleet.repairCost"
          value={formatCents(totals.totalRepairCostCents)}
        />
        <MetricStat metric="fleet.contribution"
          value={formatCents(totals.totalNetContributionCents)}
        />
        <MetricStat metric="fleet.costRecovery"
          value={`${totals.paidForItselfCount} of ${totals.applianceCount}`}
        />
        <MetricStat metric="fleet.incompleteCosts"
          value={String(totals.incompleteCostCount)}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-white p-5">
          <h2 className="font-medium text-ink">Most utilized</h2>
          <ApplianceRankList
            items={mostUtilized}
            renderValue={(a) => `${Math.round(a.utilizationFraction * 100)}%`}
          />
        </div>
        <div className="rounded-lg border border-line bg-white p-5">
          <h2 className="font-medium text-ink">Least utilized</h2>
          <ApplianceRankList
            items={leastUtilized}
            renderValue={(a) => `${Math.round(a.utilizationFraction * 100)}%`}
          />
        </div>
        <div className="rounded-lg border border-line bg-white p-5 lg:col-span-2">
          <h2 className="font-medium text-ink">Highest repair costs</h2>
          {highestRepairCost.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              No repair costs recorded yet — enter parts/labor cost on a
              maintenance job to see them here.
            </p>
          ) : (
            <ApplianceRankList
              items={highestRepairCost}
              renderValue={(a) => formatCents(a.repairCostCents)}
            />
          )}
        </div>
      </div>

      <div className="mt-8">
        <SectionCard
          title="Appliance figures and supporting records"
          description="25 units per page. Totals above cover the whole fleet; this filter only changes the list."
        >
          <nav
            aria-label="Fleet cost coverage"
            className="mb-4 flex flex-wrap gap-3 text-sm"
          >
            <Link
              aria-current={!missingOnly ? "page" : undefined}
              href={recordsHref(1, false)}
              className="inline-flex min-h-11 items-center rounded-lg border border-control px-3 underline"
            >
              All units
            </Link>
            <Link
              aria-current={missingOnly ? "page" : undefined}
              href={recordsHref(1, true)}
              className="inline-flex min-h-11 items-center rounded-lg border border-control px-3 underline"
            >
              Incomplete costs
            </Link>
          </nav>
          {records.rows.length === 0 ? (
            <EmptyState
              title={
                missingOnly ? "No incomplete costs found" : "No appliances yet"
              }
              description={
                missingOnly
                  ? "Every included unit has recorded acquisition and completed-repair costs."
                  : "Add physical units to inventory to see assignment and cost estimates."
              }
              action={
                <Link className="underline" href="/desk/inventory">
                  Open inventory
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {records.rows.map((row) => (
                <li key={row.applianceId} className="py-4">
                  <Link
                    href={`/desk/inventory/${row.applianceId}`}
                    className="font-semibold underline break-words"
                  >
                    {row.assetNumber} — {row.applianceTypeName}
                  </Link>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-ink-soft">Estimated rent (line price split evenly)</dt>
                      <dd>{formatCents(row.revenueCents)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-soft">Acquisition cost</dt>
                      <dd>
                        {row.acquisitionCostRecorded
                          ? formatCents(row.acquisitionCostCents)
                          : "Not recorded"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-soft">Recorded repair costs</dt>
                      <dd>{formatCents(row.repairCostCents)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-soft">Estimated contribution</dt>
                      <dd>{formatCents(row.netContributionCents)}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-sm text-ink-soft">
                    {!row.acquisitionCostRecorded ||
                    row.incompleteRepairJobIds.length > 0
                      ? "Cost recovery unknown — costs incomplete."
                      : row.paidForItself
                        ? "Estimated rent covers recorded costs."
                        : "Estimated rent has not covered recorded costs."}
                  </p>
                  {row.incompleteRepairJobIds.length > 0 && (
                    <p className="mt-2 text-sm text-ink-soft">
                      {row.incompleteRepairJobIds.length} completed repair(s)
                      need parts or labor cost.{" "}
                      <Link
                        className="underline"
                        href={`/desk/jobs/${row.incompleteRepairJobIds[0]}`}
                      >
                        Review first incomplete repair
                      </Link>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Pagination {...records} buildHref={recordsHref} />
        </SectionCard>
      </div>
    </div>
  );
}

function ApplianceRankList<
  T extends {
    applianceId: string;
    assetNumber: string;
    applianceTypeName: string;
  },
>({ items, renderValue }: { items: T[]; renderValue: (item: T) => string }) {
  if (items.length === 0) {
    return <p className="mt-2 text-sm text-ink-soft">Not enough data yet.</p>;
  }
  return (
    <ul className="mt-2 divide-y divide-line text-sm">
      {items.map((item) => (
        <li
          key={item.applianceId}
          className="flex items-center justify-between gap-3 py-2"
        >
          <Link
            href={`/desk/inventory/${item.applianceId}`}
            className="min-w-0 break-words text-ink hover:underline"
          >
            {item.applianceTypeName} ({item.assetNumber})
          </Link>
          <span className="shrink-0 text-ink-soft">{renderValue(item)}</span>
        </li>
      ))}
    </ul>
  );
}
