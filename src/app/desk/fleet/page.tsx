import Link from "next/link";
import { getFleetAnalytics, getApplianceCountsByStatus } from "@/domains/inventory";
import { formatCents } from "@/domains/pricing";

export const metadata = { title: "Fleet" };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="text-sm text-gray-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

export default async function FleetPage() {
  const [{ appliances, totals }, statusCounts] = await Promise.all([
    getFleetAnalytics(),
    getApplianceCountsByStatus(),
  ]);

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
      <h1 className="text-xl font-semibold">Fleet</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">
        How your whole fleet of appliances is doing — what percentage is
        earning money right now, what every unit has made vs. cost you, and
        which ones need a closer look.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total appliances" value={String(totals.applianceCount)} />
        <Stat
          label="Average utilization"
          value={`${Math.round(totals.averageUtilizationFraction * 100)}%`}
        />
        <Stat label="Currently rented" value={String(statusCounts.RENTED)} />
        <Stat label="Currently available" value={String(statusCounts.AVAILABLE)} />
        <Stat label="In maintenance" value={String(statusCounts.MAINTENANCE)} />
        <Stat label="Total invested" value={formatCents(totals.totalInvestedCents)} />
        <Stat label="Total lifetime revenue" value={formatCents(totals.totalRevenueCents)} />
        <Stat label="Total repair costs" value={formatCents(totals.totalRepairCostCents)} />
        <Stat
          label="Total net contribution"
          value={formatCents(totals.totalNetContributionCents)}
        />
        <Stat
          label="Appliances that paid for themselves"
          value={`${totals.paidForItselfCount} of ${totals.applianceCount}`}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">Most utilized</h2>
          <ApplianceRankList
            items={mostUtilized}
            renderValue={(a) => `${Math.round(a.utilizationFraction * 100)}%`}
          />
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">Least utilized</h2>
          <ApplianceRankList
            items={leastUtilized}
            renderValue={(a) => `${Math.round(a.utilizationFraction * 100)}%`}
          />
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 lg:col-span-2">
          <h2 className="font-medium text-gray-900">Highest repair costs</h2>
          {highestRepairCost.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">
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

      {appliances.length === 0 && (
        <p className="mt-6 max-w-2xl text-sm text-gray-600">
          You don&apos;t have any individual appliance units tracked yet —
          add your first one from{" "}
          <Link href="/desk/inventory" className="underline">
            Inventory
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function ApplianceRankList<
  T extends { applianceId: string; assetNumber: string; applianceTypeName: string },
>({
  items,
  renderValue,
}: {
  items: T[];
  renderValue: (item: T) => string;
}) {
  if (items.length === 0) {
    return <p className="mt-2 text-sm text-gray-600">Not enough data yet.</p>;
  }
  return (
    <ul className="mt-2 divide-y divide-gray-100 text-sm">
      {items.map((item) => (
        <li key={item.applianceId} className="flex items-center justify-between py-2">
          <Link
            href={`/desk/inventory/${item.applianceId}`}
            className="text-gray-900 hover:underline"
          >
            {item.applianceTypeName} ({item.assetNumber})
          </Link>
          <span className="text-gray-600">{renderValue(item)}</span>
        </li>
      ))}
    </ul>
  );
}
