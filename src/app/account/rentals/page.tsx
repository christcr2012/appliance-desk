import Link from "next/link";
import { TurnOffAutoRenew } from "./turn-off-auto-renew";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { getServerSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import { formatCents } from "@/domains/pricing/money";
import {
  rentalAgreementStatusLabel,
  jobStatusLabel,
  jobTypeLabel,
} from "@/lib/status-labels";

export const metadata = { title: "My rentals" };

export default async function AccountRentalsPage() {
  const session = await getServerSession();
  const customer = session ? await getPortalData(session.user.id) : null;

  if (!customer) {
    return <p className="text-gray-600">No rental account found.</p>;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">My rentals</h1>

      {customer.rentalAgreements.length === 0 ? (
        <p className="mt-4 text-sm text-gray-600">
          You don&apos;t have any rentals yet.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {customer.rentalAgreements.map((a) => {
            const total = a.lines.reduce(
              (sum, l) => sum + l.monthlyPriceCents,
              0,
            );
            return (
              <div
                key={a.id}
                className="rounded-lg border border-gray-200 bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="font-medium text-gray-900">
                    {a.serviceAddress.line1}, {a.serviceAddress.city}
                  </h2>
                  <span className="text-sm text-gray-500">
                    {rentalAgreementStatusLabel(a.status)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  {a.termMonths
                    ? `${a.termMonths}-month term`
                    : "Month-to-month"}
                </p>

                <ul className="mt-3 space-y-1 text-sm text-gray-700">
                  {a.lines.map((l) => (
                    <li key={l.id}>
                      {l.label} — {formatCents(l.monthlyPriceCents)}/month
                      {l.prepayDiscountCentsPerMonth > 0 && (
                        <span className="text-gray-500">
                          {" "}
                          (list price {formatCents(l.listPriceCents)}, includes
                          a {formatCents(l.prepayDiscountCentsPerMonth)}/month
                          term discount)
                        </span>
                      )}{" "}
                      (
                      {l.assignments
                        .map(
                          (asn) =>
                            `${asn.appliance.applianceType.name} ${asn.appliance.assetNumber}`,
                        )
                        .join(", ")}
                      )
                    </li>
                  ))}
                </ul>

                <p className="mt-3 text-sm font-medium text-gray-900">
                  Total: {formatCents(total)}/month
                </p>
                {a.freeMonthGranted && (
                  <p className="text-sm font-medium text-green-700">
                    Paid in full, in advance — your first month was free.
                  </p>
                )}
                {a.status === "ACTIVE" && a.renewalPreference === "AUTO_RENEW" && (
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-sm text-gray-900">
                      Your rental is set to renew automatically. If you would rather it ended, you can turn that off here at any time before the renewal date.
                    </p>
                    <TurnOffAutoRenew agreementId={a.id} />
                  </div>
                )}
                {a.depositCents > 0 && (
                  <p className="text-sm text-gray-600">
                    Deposit required: {formatCents(a.depositCents)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Link
        href="/account/maintenance?request=pickup"
        className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-control px-4 py-2 text-primary hover:bg-subtle"
      >
        Request pickup
      </Link>
      <p className="mt-2 text-sm text-ink-soft">
        A pickup request is reviewed by the business; it does not cancel your
        agreement or change billing automatically.
      </p>
      <div className="mt-8">
        <h2 className="font-medium text-gray-900">
          Delivery &amp; visit history
        </h2>
        {customer.jobs.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No visits scheduled yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {customer.jobs.map((j) => (
              <li key={j.id} className="px-4 py-3 text-sm">
                <p className="font-medium text-gray-900">
                  {jobTypeLabel(j.type)}
                </p>
                <p className="text-gray-600">
                  {jobStatusLabel(j.status)}
                  {j.scheduledAt &&
                    ` · ${`${formatBusinessDate(j.scheduledAt)} · ${formatBusinessTime(j.scheduledAt)}`}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
