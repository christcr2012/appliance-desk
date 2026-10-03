import Link from "next/link";
import { getEarningsReport, getJobsMissingRepairCost } from "@/domains/reports";
import { getLeadSourceBreakdown } from "@/domains/leads";
import { formatCents } from "@/domains/pricing";
import { requireRole } from "@/lib/session";
import { ExportCsvLink } from "@/components/export-csv-link";

export const metadata = { title: "Reports" };

const NOTABLE_GAP_CENTS = 1000;

export default async function ReportsPage() {
  await requireRole("OWNER", "ADMIN");
  const [earnings, missingCostJobs, leadSources] = await Promise.all([
    getEarningsReport(),
    getJobsMissingRepairCost(),
    getLeadSourceBreakdown(),
  ]);

  const notableRows = earnings.rows.filter((row) => row.gapCents > NOTABLE_GAP_CENTS);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Recorded invoice charges compared with net cash actually allocated
            to those invoices, after refunds — plus repairs missing cost inputs.
          </p>
        </div>
        <ExportCsvLink href="/desk/reports/export" label="Export transactions (CSV)" />
      </div>
      <p className="mt-2 max-w-2xl text-sm text-gray-500">
        The collection comparison uses one ledger basis on both sides. The CSV
        export includes every Receipt cash event, including unallocated
        overpayments, plus refunds and deposit returns.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-600">Invoice charges recorded</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {formatCents(earnings.totals.expectedChargesCents)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-600">Net collected (receipts − refunds)</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {formatCents(earnings.totals.netCollectedCents)}
          </p>
        </div>
        <div
          className={`rounded-lg border p-5 ${
            earnings.totals.gapCents > NOTABLE_GAP_CENTS
              ? "border-amber-300 bg-amber-50"
              : "border-gray-200 bg-white"
          }`}
        >
          <p className="text-sm text-gray-600">Gap (charges − net collected)</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {formatCents(earnings.totals.gapCents)}
          </p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="font-medium text-gray-900">Agreements with a collection gap</h2>
        <p className="mt-1 text-sm text-gray-600">
          Only agreements more than $10 short are listed. Charges include all
          invoice categories; collections are successful Receipt allocations
          minus recorded Refunds on those same invoices.
        </p>
        {notableRows.length === 0 ? (
          <p className="mt-4 text-sm text-gray-600">
            No agreement currently has a notable charge-versus-collection gap.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {notableRows.map((row) => (
              <li key={row.agreementId}>
                <Link
                  href={`/desk/agreements/${row.agreementId}`}
                  className="flex flex-col gap-1 px-4 py-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p className="font-medium text-gray-900">{row.customerName}</p>
                  <div className="text-sm text-gray-500 sm:text-right">
                    <p>
                      Charges {formatCents(row.expectedChargesCents)} · Net collected{" "}
                      {formatCents(row.netCollectedCents)}
                    </p>
                    <p className="font-medium text-amber-700">
                      {formatCents(row.gapCents)} gap
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-medium text-gray-900">Repairs missing a logged cost</h2>
        <p className="mt-1 text-sm text-gray-600">
          Completed repair jobs with either parts or labor cost missing — until
          both are logged, that appliance&apos;s profitability is incomplete.
        </p>
        {missingCostJobs.length === 0 ? (
          <p className="mt-4 text-sm text-gray-600">
            Every completed repair has both cost inputs logged.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {missingCostJobs.map((job) => {
              const first = job.appliances[0]?.appliance;
              return (
                <li key={job.id}>
                  <Link
                    href={`/desk/jobs/${job.id}`}
                    className="flex flex-col gap-1 px-4 py-3 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <p className="text-sm text-gray-900">
                      {first ? `${first.applianceType.name} ${first.assetNumber}` : "Repair job"}
                      {job.customer && (
                        <span className="text-gray-500">
                          {" "}
                          — {job.customer.user.name ?? job.customer.user.email}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-gray-500">
                      Completed{" "}
                      {job.completedAt ? new Date(job.completedAt).toLocaleDateString("en-US") : ""}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-medium text-gray-900">Where your leads come from</h2>
        <p className="mt-1 text-sm text-gray-600">
          Every lead, grouped by how they said they heard about you, with how
          many of each group became a customer.
        </p>
        {leadSources.length === 0 ? (
          <p className="mt-4 text-sm text-gray-600">No leads yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {leadSources.map((row) => (
              <li key={row.source} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <p className="text-gray-900">{row.source}</p>
                <p className="text-gray-500">
                  {row.total} lead{row.total === 1 ? "" : "s"} · {row.converted} converted ({Math.round(row.conversionRate * 100)}%)
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
