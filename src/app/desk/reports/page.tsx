import Link from "next/link";
import {
  getEarningsReport,
  getJobsMissingRepairCost,
} from "@/domains/reports";
import { getLeadSourceBreakdown } from "@/domains/leads";
import { formatCents } from "@/domains/pricing";
import { requireRole } from "@/lib/session";
import { ExportCsvLink } from "@/components/export-csv-link";
import { MetricStat } from "@/components/desk/metric-stat";
import {
  Card,
  DataList,
  EmptyState,
  PageHeader,
  type DataListColumn,
} from "@/components/ui";

export const metadata = { title: "Reports" };

const NOTABLE_GAP_CENTS = 1000;

type EarningsRow = Awaited<
  ReturnType<typeof getEarningsReport>
>["rows"][number];
type MissingRepairRow = Awaited<
  ReturnType<typeof getJobsMissingRepairCost>
>[number];
type LeadSourceRow = Awaited<
  ReturnType<typeof getLeadSourceBreakdown>
>[number];

export default async function ReportsPage() {
  await requireRole("OWNER", "ADMIN");
  const [earnings, missingCostJobs, leadSources] = await Promise.all([
    getEarningsReport(),
    getJobsMissingRepairCost(),
    getLeadSourceBreakdown(),
  ]);

  const notableRows = earnings.rows.filter(
    (row) => row.gapCents > NOTABLE_GAP_CENTS,
  );

  const earningsColumns: DataListColumn<EarningsRow>[] = [
    {
      key: "customer",
      header: "Customer",
      primary: true,
      cell: (row) => (
        <Link
          href={`/desk/agreements/${row.agreementId}`}
          className="font-semibold text-ink underline-offset-4 hover:underline"
        >
          {row.customerName}
        </Link>
      ),
    },
    {
      key: "estimated",
      header: "Estimated",
      cell: (row) => formatCents(row.estimatedCents),
    },
    {
      key: "collected",
      header: "Collected",
      cell: (row) => formatCents(row.actualCents),
    },
    {
      key: "gap",
      header: "Gap",
      cell: (row) => (
        <span className="font-semibold text-warning-ink">
          {formatCents(row.gapCents)} behind
        </span>
      ),
    },
  ];

  const repairColumns: DataListColumn<MissingRepairRow>[] = [
    {
      key: "repair",
      header: "Repair",
      primary: true,
      cell: (job) => {
        const first = job.appliances[0]?.appliance;
        return (
          <Link
            href={`/desk/jobs/${job.id}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            {first
              ? `${first.applianceType.name} ${first.assetNumber}`
              : "Repair job"}
          </Link>
        );
      },
    },
    {
      key: "customer",
      header: "Customer",
      cell: (job) =>
        job.customer
          ? job.customer.user.name ?? job.customer.user.email
          : "No customer",
    },
    {
      key: "completed",
      header: "Completed",
      cell: (job) =>
        job.completedAt
          ? new Date(job.completedAt).toLocaleDateString("en-US")
          : "—",
    },
  ];

  const leadColumns: DataListColumn<LeadSourceRow>[] = [
    {
      key: "source",
      header: "Source",
      primary: true,
      cell: (row) => row.source,
    },
    {
      key: "leads",
      header: "Leads",
      cell: (row) => String(row.total),
    },
    {
      key: "converted",
      header: "Converted",
      cell: (row) => String(row.converted),
    },
    {
      key: "rate",
      header: "Conversion rate",
      cell: (row) => `${Math.round(row.conversionRate * 100)}%`,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Compare agreed pricing with collections, find completed repairs missing cost data, and review lead-source conversion."
        secondaryActions={
          <ExportCsvLink
            href="/desk/reports/export"
            label="Export transactions (CSV)"
          />
        }
      />

      <p className="max-w-2xl text-sm text-ink-soft">
        The export contains every payment, refund, and security-deposit
        movement on file, oldest first, for bookkeeping or accounting import.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricStat
          metric="reports.estimatedEarnings"
          value={formatCents(earnings.totals.estimatedCents)}
        />
        <MetricStat
          metric="reports.collected"
          value={formatCents(earnings.totals.actualCents)}
        />
        <MetricStat
          metric="reports.gap"
          value={formatCents(earnings.totals.gapCents)}
          tone={
            earnings.totals.gapCents > NOTABLE_GAP_CENTS
              ? "warning"
              : "default"
          }
        />
      </div>

      <div className="mt-8 space-y-6">
        <Card
          title="Agreements falling behind their own pricing"
          description="Only agreements more than $10 short are listed so small timing differences do not create noise."
        >
          <DataList
            rows={notableRows}
            columns={earningsColumns}
            caption="Agreements falling behind their own pricing"
            empty={
              <EmptyState
                title="Nothing is behind right now"
                description="Every billing agreement's collections are keeping up with its agreed price."
              />
            }
          />
        </Card>

        <Card
          title="Repairs missing a logged cost"
          description="Completed repair jobs with no parts or labor cost entered yet. Until the cost is logged, Fleet profitability treats that repair as free."
        >
          <DataList
            rows={missingCostJobs}
            columns={repairColumns}
            caption="Repairs missing a logged cost"
            empty={
              <EmptyState
                title="Every completed repair has a cost logged"
                description="Nothing needs cost follow-up here."
              />
            }
          />
        </Card>

        <Card
          title="Where your leads come from"
          description="Lead sources with conversion counts and rates so marketing performance can be compared."
        >
          <DataList
            rows={leadSources}
            columns={leadColumns}
            caption="Lead source conversion"
            empty={
              <EmptyState
                title="No leads yet"
                description="Lead-source reporting will appear after leads are recorded."
              />
            }
          />
        </Card>
      </div>

      <p className="mt-6 max-w-2xl text-xs text-ink-faint">
        “Estimated” is reconstructed from each agreement&apos;s agreed monthly
        price and how long it has been billing. “Collected” is money received
        and account credit applied to that agreement&apos;s invoices, minus
        recorded refunds. This is a reconciliation aid, not a legal record;
        the invoice and payment history on each customer&apos;s page remains
        the exact record.
      </p>
    </div>
  );
}
