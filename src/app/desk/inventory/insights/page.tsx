// AR-9 (INSIGHTS section 5): Equipment › Insights — the fleet page's
// numbers where the owner works. OWNER/ADMIN only. The fleet report table
// keeps the fleet page's own page/costs params.
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { formatMoney } from "@/lib/money-ui";
import { formatShortDate } from "@/lib/business-date";
import { getEquipmentInsights } from "@/domains/insights/equipment";
import { DataTable, InfoTip, ScreenHeader, SidePanel, StatStrip, type Column } from "@/components/kit";
import { MetricHelp } from "@/components/desk/metric-stat";
import type { ApplianceProfitability } from "@/domains/inventory";

export const metadata = { title: "Equipment insights" };

export default async function EquipmentInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; costs?: string; open?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const params = await searchParams;
  const now = new Date();
  const data = await getEquipmentInsights({ page: params.page, costs: params.costs }, now);
  const missingOnly = params.costs === "missing";

  const rankList = (items: ApplianceProfitability[], value: (a: ApplianceProfitability) => string) =>
    items.length === 0 ? (
      <p className="text-sm text-ink-soft">No appliances yet.</p>
    ) : (
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((a) => (
          <li key={a.applianceId} className="flex justify-between gap-3">
            <Link href={`/desk/inventory/${a.applianceId}`} className="font-bold text-ink hover:underline">
              {a.assetNumber} — {a.applianceTypeName}
            </Link>
            <span className="tabular-nums">{value(a)}</span>
          </li>
        ))}
      </ul>
    );

  const reportColumns: Column<ApplianceProfitability>[] = [
    {
      key: "appliance", header: "Appliance",
      // Plain text: the kit table wraps the first cell in its panel link
      // and this page renders the side panel for ?open= (below), whose
      // "Open full page" goes to the appliance record. A second link
      // here nested anchors, which browsers split into two same-named
      // links (the fleet spec's page-2 strict-mode failure).
      cell: (r) => (
        <span className="font-bold text-ink">
          {r.assetNumber} — {r.applianceTypeName}
        </span>
      ),
    },
    { key: "rent", header: "Estimated rent (line price split evenly)", cell: (r) => formatMoney(r.revenueCents) },
    { key: "acquisition", header: "Acquisition cost", cell: (r) => (r.acquisitionCostRecorded ? formatMoney(r.acquisitionCostCents) : "Not recorded") },
    { key: "repairs", header: "Recorded repair costs", cell: (r) => formatMoney(r.repairCostCents) },
    { key: "contribution", header: "Estimated contribution", cell: (r) => formatMoney(r.netContributionCents) },
    {
      key: "coverage", header: "Cost recovery",
      cell: (r) =>
        !r.acquisitionCostRecorded || r.incompleteRepairJobIds.length > 0
          ? "Unknown — costs incomplete"
          : r.paidForItself
            ? "Estimated rent covers recorded costs"
            : "Estimated rent has not covered recorded costs",
    },
  ];

  // Desktop rows open the kit side panel (?open=<applianceId>): the row
  // is already loaded for the table, so the panel shows its own figures
  // and "Open full page" reaches the appliance record. Without this the
  // panel links landed on a page that never rendered a panel and
  // desktop navigation went nowhere (Codex P2 on PR #747).
  const openRow = params.open ? (data.report.rows.find((r) => r.applianceId === params.open) ?? null) : null;
  const closeHref = `/desk/inventory/insights?costs=${missingOnly ? "missing" : "all"}&page=${data.report.page}`;

  return (
    <div className="flex items-start px-1 sm:px-0">
      <div className="flex min-w-0 flex-1 flex-col gap-8">
      <ScreenHeader title="Equipment" />
      <StatStrip
        items={[
          { label: "Appliances", value: String(data.totalAppliances) },
          {
            label: "Rented out",
            value: String(data.rentedOut),
            info: "fleet-utilization",
            sub: data.utilizationPercent === null ? undefined : `${Math.round(data.utilizationPercent)}% of appliance time rented`,
          },
          { label: "Available", value: String(data.available) },
          { label: `Idle ${data.idleDays}+ days`, value: String(data.idle.total), info: "idle-appliance" },
        ]}
      />
      {data.idle.sample.length > 0 ? (
        <ul className="-mt-4 flex flex-col gap-1 text-sm">
          {data.idle.sample.map((a) => (
            <li key={a.id}>
              <Link href={`/desk/inventory/${a.id}`} className="font-bold text-primary hover:underline">
                {a.assetNumber} — {a.typeName}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-1.5 text-base font-extrabold text-ink">
          Value and cost <InfoTip term="fleet-numbers" />
        </h2>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-3"><dt>Invested in appliances</dt><dd className="font-bold">{formatMoney(data.totals.totalInvestedCents)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Rental value so far</dt><dd className="font-bold">{formatMoney(data.totals.totalRevenueCents)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Recorded repair costs</dt><dd className="font-bold">{formatMoney(data.totals.totalRepairCostCents)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Estimated contribution</dt><dd className="font-bold">{formatMoney(data.totals.totalNetContributionCents)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Paid for themselves</dt><dd className="font-bold">{data.totals.paidForItselfCount} of {data.totals.applianceCount}</dd></div>
          <div className="flex justify-between gap-3"><dt>Appliances with incomplete costs</dt><dd className="font-bold">{data.totals.incompleteCostCount}</dd></div>
        </dl>
        <MetricHelp metric="fleet.contribution" />
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-extrabold text-ink">Most used</h3>
            {rankList(data.mostUsed, (a) => `${Math.round(a.utilizationFraction * 100)}%`)}
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-extrabold text-ink">Least used</h3>
            {rankList(data.leastUsed, (a) => `${Math.round(a.utilizationFraction * 100)}%`)}
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-extrabold text-ink">Highest repair costs</h3>
            {rankList(data.highestRepairCosts, (a) => formatMoney(a.repairCostCents))}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-extrabold text-ink">Flags</h2>
        {data.flags.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing flagged right now.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {data.flags.map((row) => (
              <li key={row.applianceTypeId} className="flex justify-between gap-3">
                <span className="font-bold">{row.applianceTypeName} — {row.unitCount} unit{row.unitCount === 1 ? "" : "s"}</span>
                <span>
                  {Math.round(row.averageUtilizationFraction * 100)}% utilized —{" "}
                  {row.flag === "SHORTAGE" ? "consider buying more" : "consider reviewing price/stock"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-1.5 text-base font-extrabold text-ink">
          What people are asking for <InfoTip term="demand-gap" />
        </h2>
        {data.demand.length === 0 ? (
          <p className="text-sm text-ink-soft">No open lead demand to estimate.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {data.demand.map((row) => (
              <li key={row.applianceTypeId} className="flex justify-between gap-3">
                <span className="font-bold">{row.applianceTypeName}</span>
                <span>
                  {row.openLeadRequestedUnits} open requests · {row.availableUnitsEstimate} available · gap {row.estimatedUnitGap}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-extrabold text-ink">Repairs missing a cost</h2>
        {data.jobsMissingRepairCost.length === 0 ? (
          <p className="text-sm text-ink-soft">Every finished repair has a cost.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {data.jobsMissingRepairCost.map((job) => (
              <li key={job.id}>
                <Link href={`/desk/jobs/${job.id}`} className="font-bold text-primary hover:underline">
                  {job.customer ? (job.customer.user.name ?? job.customer.user.email) : "No customer on the job"}
                  {job.appliances[0]
                    ? ` — ${job.appliances[0].appliance.assetNumber} (${job.appliances[0].appliance.applianceType.name})`
                    : ""}
                  {job.completedAt ? ` · finished ${formatShortDate(job.completedAt, now)}` : ""}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-extrabold text-ink">All appliances: value and cost</h2>
          <div className="flex gap-2 text-sm">
            <Link
              href="/desk/inventory/insights"
              aria-current={!missingOnly ? "page" : undefined}
              className={!missingOnly ? "font-extrabold text-ink underline" : "font-bold text-primary hover:underline"}
            >
              All units
            </Link>
            <span aria-hidden="true" className="text-ink-soft">·</span>
            <Link
              href="/desk/inventory/insights?costs=missing"
              aria-current={missingOnly ? "page" : undefined}
              className={missingOnly ? "font-extrabold text-ink underline" : "font-bold text-primary hover:underline"}
            >
              Incomplete costs
            </Link>
          </div>
        </div>
        <DataTable
          caption="All appliances: value and cost"
          rows={data.report.rows}
          rowKey={(r) => r.applianceId}
          columns={reportColumns}
          rowHref={(r) => `/desk/inventory/${r.applianceId}`}
          selectedKey={openRow?.applianceId}
          mobileCard={(r) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-3">
                <span className="font-bold text-ink">{r.assetNumber} — {r.applianceTypeName}</span>
                <span className="font-extrabold text-ink tabular-nums">{formatMoney(r.netContributionCents)}</span>
              </div>
              <p className="text-sm text-ink-soft">
                Rent {formatMoney(r.revenueCents)} · repairs {formatMoney(r.repairCostCents)}
              </p>
            </div>
          )}
          empty={<p className="text-sm text-ink-soft">No appliances match this filter.</p>}
        />
        {data.report.totalPages > 1 ? (
          <div className="flex items-center gap-3 text-sm">
            {data.report.page > 1 ? (
              <Link
                href={`/desk/inventory/insights?costs=${missingOnly ? "missing" : "all"}&page=${data.report.page - 1}`}
                className="font-bold text-primary hover:underline"
              >
                Previous
              </Link>
            ) : null}
            <span>Page {data.report.page} of {data.report.totalPages}</span>
            {data.report.page < data.report.totalPages ? (
              <Link
                href={`/desk/inventory/insights?costs=${missingOnly ? "missing" : "all"}&page=${data.report.page + 1}`}
                className="font-bold text-primary hover:underline"
              >
                Next
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>
      </div>
      {openRow ? (
        <SidePanel
          title={`${openRow.assetNumber} — ${openRow.applianceTypeName}`}
          closeHref={closeHref}
          fullHref={`/desk/inventory/${openRow.applianceId}`}
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {[
              { label: "Estimated rent", value: formatMoney(openRow.revenueCents) },
              { label: "Acquisition cost", value: openRow.acquisitionCostRecorded ? formatMoney(openRow.acquisitionCostCents) : "Not recorded" },
              { label: "Recorded repair costs", value: formatMoney(openRow.repairCostCents) },
              { label: "Estimated contribution", value: formatMoney(openRow.netContributionCents) },
            ].map((stat) => (
              <div key={stat.label} className="min-w-0">
                <dt className="text-xs font-bold text-ink-soft">{stat.label}</dt>
                <dd className="mt-0.5 text-[15px] font-bold tabular-nums text-ink">{stat.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-ink-soft">
            {!openRow.acquisitionCostRecorded || openRow.incompleteRepairJobIds.length > 0
              ? "Cost recovery is unknown — costs incomplete."
              : openRow.paidForItself
                ? "Estimated rent covers recorded costs."
                : "Estimated rent has not covered recorded costs yet."}
          </p>
        </SidePanel>
      ) : null}
    </div>
  );
}
