import Link from "next/link";
import type { ApplianceProfitability } from "@/domains/inventory";
import { formatCents } from "@/domains/pricing";

export function ApplianceEarningsSummary({
  report,
}: {
  report: ApplianceProfitability;
}) {
  const incomplete =
    !report.acquisitionCostRecorded || report.incompleteRepairJobIds.length > 0;
  return (
    <section
      aria-label="Appliance earnings estimate"
      className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm"
    >
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-ink-soft">Estimated rental value</dt>
          <dd className="font-semibold text-ink">
            {formatCents(report.revenueCents)}
          </dd>
        </div>
        <div>
          <dt className="text-ink-soft">Recorded repair costs</dt>
          <dd className="font-semibold text-ink">
            {formatCents(report.repairCostCents)}
          </dd>
        </div>
        <div>
          <dt className="text-ink-soft">Estimated contribution</dt>
          <dd className="font-semibold text-ink">
            {formatCents(report.netContributionCents)}
          </dd>
        </div>
        <div>
          <dt className="text-ink-soft">Estimated cost recovery</dt>
          <dd className="font-semibold text-ink">
            {incomplete
              ? "Unknown — costs incomplete"
              : report.paidForItself
                ? "Covered by estimated rental value"
                : "Not yet covered"}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-ink-soft">
        Rental value uses assignment days and agreed rates, prorated over 30
        days and split across the distinct units assigned to a rental line.
        Contribution subtracts recorded acquisition and repair costs. These
        estimates do not establish payments collected or business profit.
      </p>
      {!report.acquisitionCostRecorded && (
        <p className="mt-2 text-ink-soft">
          Acquisition cost is missing. Enter the amount in this appliance&apos;s
          details; an explicit $0 is treated as recorded.
        </p>
      )}
      {report.incompleteRepairJobIds.length > 0 && (
        <div className="mt-2">
          <p className="text-ink-soft">
            Parts or labor cost is missing on completed repairs:
          </p>
          <ul className="mt-1 space-y-1">
            {report.incompleteRepairJobIds.slice(0, 5).map((id) => (
              <li key={id}>
                <Link
                  className="break-words underline"
                  href={`/desk/jobs/${id}`}
                >
                  Review repair {id}
                </Link>
              </li>
            ))}
          </ul>
          {report.incompleteRepairJobIds.length > 5 && (
            <Link
              className="mt-2 inline-block underline"
              href="/desk/jobs?status=COMPLETED"
            >
              See completed jobs
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
