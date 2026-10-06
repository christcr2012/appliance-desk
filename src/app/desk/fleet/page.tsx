import { requireRole } from "@/lib/session";
import Link from "next/link";
import {
  getFleetAnalytics,
  getApplianceCountsByStatus,
} from "@/domains/inventory";
import { formatCents } from "@/domains/pricing";
import { fleetReportPage } from "@/domains/inventory/fleet-report";
import {
  ButtonLink,
  Card,
  DataList,
  EmptyState,
  PageHeader,
  type DataListColumn,
} from "@/components/ui";
import { FilterBar } from "@/components/desk/workspace";
import { Pagination } from "@/components/pagination";
import { MetricStat } from "@/components/desk/metric-stat";
import {
  formatBusinessDate,
  formatBusinessTime,
} from "@/lib/business-date";

export const metadata = { title: "Fleet" };

type FleetAppliance = Awaited<
  ReturnType<typeof getFleetAnalytics>
>["appliances"][number];

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

  const records = fleetReportPage(
    appliances,
    query.page,
    missingOnly,
  );
  const recordsHref = (page = 1, missing = missingOnly) =>
    `/desk/fleet?${new URLSearchParams({
      costs: missing ? "missing" : "all",
      page: String(page),
    })}`;

  const byUtilization = [...appliances].sort(
    (a, b) => b.utilizationFraction - a.utilizationFraction,
  );
  const mostUtilized = byUtilization.slice(0, 5);
  const leastUtilized = [...byUtilization].reverse().slice(0, 5);
  const highestRepairCost = [...appliances]
    .filter((appliance) => appliance.repairCostCents > 0)
    .sort((a, b) => b.repairCostCents - a.repairCostCents)
    .slice(0, 5);

  const columns: DataListColumn<FleetAppliance>[] = [
    {
      key: "appliance",
      header: "Appliance",
      primary: true,
      cell: (row) => (
        <Link
          href={`/desk/inventory/${row.applianceId}`}
          className="font-semibold text-ink underline-offset-4 hover:underline"
        >
          {row.assetNumber} — {row.applianceTypeName}
        </Link>
      ),
    },
    {
      key: "rent",
      header: "Estimated rent (line price split evenly)",
      cell: (row) => formatCents(row.revenueCents),
    },
    {
      key: "acquisition",
      header: "Acquisition cost",
      cell: (row) =>
        row.acquisitionCostRecorded
          ? formatCents(row.acquisitionCostCents)
          : "Not recorded",
    },
    {
      key: "repairs",
      header: "Recorded repair costs",
      cell: (row) => formatCents(row.repairCostCents),
    },
    {
      key: "contribution",
      header: "Estimated contribution",
      cell: (row) => formatCents(row.netContributionCents),
    },
    {
      key: "coverage",
      header: "Cost recovery",
      cell: (row) => (
        <div className="space-y-1">
          <p>
            {!row.acquisitionCostRecorded ||
            row.incompleteRepairJobIds.length > 0
              ? "Unknown — costs incomplete"
              : row.paidForItself
                ? "Estimated rent covers recorded costs"
                : "Estimated rent has not covered recorded costs"}
          </p>
          {row.incompleteRepairJobIds.length > 0 && (
            <Link
              className="font-medium text-ink underline-offset-4 hover:underline"
              href={`/desk/jobs/${row.incompleteRepairJobIds[0]}`}
            >
              Review first incomplete repair
            </Link>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Fleet and appliance estimates"
        description="Assignment-based rental value, recorded costs, and the appliance records behind them."
      />

      <Card
        title="How to read these estimates"
        actions={
          <ButtonLink href="/desk/revenue" variant="secondary">
            Review payments and refunds
          </ButtonLink>
        }
      >
        <div className="space-y-2 text-sm text-ink-soft">
          <p>
            As of {formatBusinessDate(asOf)} at {formatBusinessTime(asOf)}.
            Includes all non-archived appliances, including retired units still
            on file. Utilization is assigned time since each unit was added, not
            the percentage of units rented today.
          </p>
          <p>
            Rental value uses agreed monthly prices, 30-day proration, and
            assignment dates; a rental line is split across its distinct
            assigned units. It is not invoiced or collected revenue. Recorded
            repair cost is the parts plus labor entered on completed maintenance
            visits; a shared job&apos;s full entered cost appears on each linked
            unit.
          </p>
          <p>
            Contribution subtracts recorded acquisition and repair costs. Blank
            costs contribute no recorded amount and remain incomplete. Deposits,
            refunds, overdue invoices, operating overhead, and taxes are not
            apportioned here, so these figures do not establish cash collected
            or business profit.
          </p>
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricStat
          metric="fleet.applianceCount"
          value={String(totals.applianceCount)}
        />
        <MetricStat
          metric="fleet.utilization"
          value={`${Math.round(
            totals.averageUtilizationFraction * 100,
          )}%`}
        />
        <MetricStat
          metric="fleet.rented"
          value={String(statusCounts.RENTED)}
        />
        <MetricStat
          metric="fleet.available"
          value={String(statusCounts.AVAILABLE)}
        />
        <MetricStat
          metric="fleet.maintenance"
          value={String(statusCounts.MAINTENANCE)}
        />
        <MetricStat
          metric="fleet.acquisitionCost"
          value={formatCents(totals.totalInvestedCents)}
        />
        <MetricStat
          metric="fleet.rentalValue"
          value={formatCents(totals.totalRevenueCents)}
        />
        <MetricStat
          metric="fleet.repairCost"
          value={formatCents(totals.totalRepairCostCents)}
        />
        <MetricStat
          metric="fleet.contribution"
          value={formatCents(totals.totalNetContributionCents)}
        />
        <MetricStat
          metric="fleet.costRecovery"
          value={`${totals.paidForItselfCount} of ${totals.applianceCount}`}
        />
        <MetricStat
          metric="fleet.incompleteCosts"
          value={String(totals.incompleteCostCount)}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Most utilized">
          <ApplianceRankList
            items={mostUtilized}
            renderValue={(appliance) =>
              `${Math.round(appliance.utilizationFraction * 100)}%`
            }
          />
        </Card>
        <Card title="Least utilized">
          <ApplianceRankList
            items={leastUtilized}
            renderValue={(appliance) =>
              `${Math.round(appliance.utilizationFraction * 100)}%`
            }
          />
        </Card>
        <div className="lg:col-span-2">
          <Card title="Highest repair costs">
            {highestRepairCost.length === 0 ? (
              <EmptyState
                title="No repair costs recorded yet"
                description="Enter parts and labor cost on a completed maintenance job to see rankings here."
              />
            ) : (
              <ApplianceRankList
                items={highestRepairCost}
                renderValue={(appliance) =>
                  formatCents(appliance.repairCostCents)
                }
              />
            )}
          </Card>
        </div>
      </div>

      <div className="mt-8">
        <Card
          title="Appliance figures and supporting records"
          description="25 units per page. Totals above cover the whole fleet; this filter only changes the list."
        >
          <FilterBar
            label="Fleet cost coverage"
            items={[
              {
                label: "All units",
                href: recordsHref(1, false),
                active: !missingOnly,
              },
              {
                label: "Incomplete costs",
                href: recordsHref(1, true),
                active: missingOnly,
              },
            ]}
          />

          <DataList
            rows={records.rows}
            columns={columns}
            caption="Fleet appliance figures"
            empty={
              <EmptyState
                title={
                  missingOnly
                    ? "No incomplete costs found"
                    : "No appliances yet"
                }
                description={
                  missingOnly
                    ? "Every included unit has recorded acquisition and completed-repair costs."
                    : "Add physical units to inventory to see assignment and cost estimates."
                }
                action={
                  <ButtonLink href="/desk/inventory" variant="secondary">
                    Open inventory
                  </ButtonLink>
                }
              />
            }
          />

          <Pagination {...records} buildHref={recordsHref} />
        </Card>
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
>({
  items,
  renderValue,
}: {
  items: T[];
  renderValue: (item: T) => string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-soft">Not enough data yet.</p>;
  }

  return (
    <ul className="divide-y divide-line text-sm">
      {items.map((item) => (
        <li
          key={item.applianceId}
          className="flex items-center justify-between gap-3 py-2"
        >
          <Link
            href={`/desk/inventory/${item.applianceId}`}
            className="min-w-0 break-words text-ink underline-offset-4 hover:underline"
          >
            {item.applianceTypeName} ({item.assetNumber})
          </Link>
          <span className="shrink-0 text-ink-soft">
            {renderValue(item)}
          </span>
        </li>
      ))}
    </ul>
  );
}
