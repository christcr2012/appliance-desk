import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getAllEstimates, totalMonthlyCents, totalOneTimeCents } from "@/domains/estimates";
import { formatCents } from "@/domains/pricing";
import { estimateStatusLabel } from "@/lib/status-labels";

export const metadata = { title: "Estimates" };

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  SENT: "bg-yellow-100 text-yellow-800",
  VIEWED: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-green-100 text-green-800",
  CHANGES_REQUESTED: "bg-amber-100 text-amber-800",
  DECLINED: "bg-red-100 text-red-800",
  EXPIRED: "bg-gray-200 text-gray-700",
  CONVERTED: "bg-blue-100 text-blue-800",
};

/** Custom-priced estimates for deals that don't fit standard self-serve
 * pricing — a property manager ordering for several units, an entire
 * building, and similar (2026-09-29, see docs/DECISIONS.md). Always
 * OWNER/ADMIN: an estimate is where custom pricing gets decided, same
 * access level as Billing/Settings. */
export default async function EstimatesPage() {
  await requireRole("OWNER", "ADMIN");
  const estimates = await getAllEstimates();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Estimates</h1>
        <Link
          href="/desk/estimates/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          + New estimate
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Custom-priced proposals for deals that don&apos;t fit standard
        pricing — a property manager ordering for several units, a whole
        building, and similar.
      </p>

      {estimates.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">No estimates yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {estimates.map((estimate) => {
            const monthly = totalMonthlyCents(estimate.lineItems);
            const oneTime = totalOneTimeCents(estimate.lineItems);
            return (
              <li key={estimate.id}>
                <Link
                  href={`/desk/estimates/${estimate.id}`}
                  className="flex flex-col gap-1 px-4 py-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      #{estimate.estimateNumber} — {estimate.title}
                    </p>
                    <p className="text-sm text-gray-600">
                      {estimate.customer.user.name ?? estimate.customer.user.email}
                      {estimate.customer.companyName ? ` · ${estimate.customer.companyName}` : ""}
                    </p>
                  </div>
                  <div className="text-sm text-gray-500 sm:text-right">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[estimate.status] ?? "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {estimateStatusLabel(estimate.status)}
                    </span>
                    <p className="mt-1">
                      {monthly > 0 && `${formatCents(monthly)}/mo`}
                      {monthly > 0 && oneTime > 0 && " + "}
                      {oneTime > 0 && `${formatCents(oneTime)} one-time`}
                      {monthly === 0 && oneTime === 0 && "No line items yet"}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
