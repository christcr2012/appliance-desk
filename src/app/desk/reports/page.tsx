import Link from "next/link";
import { getEarningsReport, getJobsMissingRepairCost } from "@/domains/reports";
import { getLeadSourceBreakdown } from "@/domains/leads";
import { formatCents } from "@/domains/pricing";
import { requireRole } from "@/lib/session";
import { ExportCsvLink } from "@/components/export-csv-link";

export const metadata = { title: "Reports" };

/** A gap worth calling out on its own row, not just sorting order — small
 * rounding/timing noise (an invoice that posted a day late, say) isn't
 * worth flagging as "behind." $10 is a deliberately low, simple bar: this
 * is meant to catch real shortfalls, not create noise. */
const NOTABLE_GAP_CENTS = 1000;

// OWNER/ADMIN only (docs/DECISIONS.md, 2026-09-28 "Staff permissions
// framework") — never rely on the nav link being hidden alone.
export default async function ReportsPage() {
  await requireRole("OWNER", "ADMIN");
  const [earnings, missingCostJobs, leadSources] = await Promise.all([
    getEarningsReport(),
    getJobsMissingRepairCost(),
    getLeadSourceBreakdown(),
  ]);

  const notableRows = earnings.rows.filter((r) => r.gapCents > NOTABLE_GAP_CENTS);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            What your agreements&apos; agreed pricing says you should have
            collected by now, compared with what&apos;s actually been paid —
            and repairs that are missing their cost, which would otherwise
            quietly make an appliance look more profitable than it really was.
          </p>
        </div>
        <ExportCsvLink href="/desk/reports/export" label="Export transactions (CSV)" />
      </div>
      <p className="mt-2 max-w-2xl text-sm text-gray-500">
        The export is every payment, refund, and security deposit movement
        on file, oldest first — hand it to a bookkeeper or import it into
        whatever accounting software you end up using.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-600">Estimated earnings (all billing agreements)</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {formatCents(earnings.totals.estimatedCents)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-600">Actually collected</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {formatCents(earnings.totals.actualCents)}
          </p>
        </div>
        <div
          className={`rounded-lg border p-5 ${
            earnings.totals.gapCents > NOTABLE_GAP_CENTS
              ? "border-amber-300 bg-amber-50"
              : "border-gray-200 bg-white"
          }`}
        >
          <p className="text-sm text-gray-600">Gap (estimated minus collected)</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {formatCents(earnings.totals.gapCents)}
          </p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="font-medium text-gray-900">Agreements falling behind their own pricing</h2>
        <p className="mt-1 text-sm text-gray-600">
          Only agreements more than $10 short are listed — small
          timing differences (an invoice that posted a day or two late)
          aren&apos;t worth flagging.
        </p>
        {notableRows.length === 0 ? (
          <p className="mt-4 text-sm text-gray-600">
            Nothing behind right now — every billing agreement&apos;s
            collections are keeping up with its agreed price.
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
                      Estimated {formatCents(row.estimatedCents)} · Collected{" "}
                      {formatCents(row.actualCents)}
                    </p>
                    <p className="font-medium text-amber-700">
                      {formatCents(row.gapCents)} behind
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
          Completed repair jobs with no parts or labor cost entered yet —
          until it&apos;s logged, that appliance&apos;s profitability
          (Fleet page) counts this repair as free, which almost certainly
          isn&apos;t true.
        </p>
        {missingCostJobs.length === 0 ? (
          <p className="mt-4 text-sm text-gray-600">
            Every completed repair has a cost logged. Nothing to fix here.
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
          Every lead, grouped by how they said they heard about you, with
          how many of each group actually became a customer — a quick way
          to see whether your marketing is actually working, not just word
          of mouth (or the other way around).
        </p>
        {leadSources.length === 0 ? (
          <p className="mt-4 text-sm text-gray-600">No leads yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {leadSources.map((row) => (
              <li key={row.source} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <p className="text-gray-900">{row.source}</p>
                <p className="text-gray-500">
                  {row.total} lead{row.total === 1 ? "" : "s"} · {row.converted} converted (
                  {Math.round(row.conversionRate * 100)}%)
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 max-w-2xl text-xs text-gray-500">
        &ldquo;Estimated&rdquo; is reconstructed from each agreement&apos;s
        own agreed monthly price and how long it&apos;s actually been
        billing — the same math used elsewhere in the app for revenue
        trends. &ldquo;Collected&rdquo; comes straight from what Stripe has
        actually processed. This is a reconciliation aid, not a legal
        record — the real invoice/payment history on each customer&apos;s
        page is always the exact figure.
      </p>
    </div>
  );
}
