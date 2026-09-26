import { getServerSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import { formatCents } from "@/domains/pricing/money";

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
        <p className="mt-4 text-sm text-gray-600">You don&apos;t have any rentals yet.</p>
      ) : (
        <div className="mt-6 space-y-6">
          {customer.rentalAgreements.map((a) => {
            const total = a.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0);
            return (
              <div key={a.id} className="rounded-lg border border-gray-200 bg-white p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-medium text-gray-900">
                    {a.serviceAddress.line1}, {a.serviceAddress.city}
                  </h2>
                  <span className="text-sm text-gray-500">{a.status}</span>
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  {a.termMonths ? `${a.termMonths}-month term` : "Month-to-month"}
                </p>

                <ul className="mt-3 space-y-1 text-sm text-gray-700">
                  {a.lines.map((l) => (
                    <li key={l.id}>
                      {l.label} — {formatCents(l.monthlyPriceCents)}/month (
                      {l.assignments
                        .map((asn) => `${asn.appliance.applianceType.name} ${asn.appliance.assetNumber}`)
                        .join(", ")}
                      )
                    </li>
                  ))}
                </ul>

                <p className="mt-3 text-sm font-medium text-gray-900">
                  Total: {formatCents(total)}/month
                </p>
                {a.depositCents > 0 && (
                  <p className="text-sm text-gray-600">
                    Deposit paid: {formatCents(a.depositCents)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8">
        <h2 className="font-medium text-gray-900">Delivery &amp; visit history</h2>
        {customer.jobs.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No visits scheduled yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {customer.jobs.map((j) => (
              <li key={j.id} className="px-4 py-3 text-sm">
                <p className="font-medium text-gray-900">{j.type}</p>
                <p className="text-gray-600">
                  {j.status}
                  {j.scheduledAt && ` · ${new Date(j.scheduledAt).toLocaleString()}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
