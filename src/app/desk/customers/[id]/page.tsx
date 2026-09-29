import { notFound } from "next/navigation";
import Link from "next/link";
import { getCustomerById, getCustomerTimeline, getCustomerContacts } from "@/domains/customers";
import { formatCents } from "@/domains/pricing";
import { ResendActivationButton } from "./resend-activation-button";
import { AddNoteForm } from "./add-note-form";
import { ContactsPanel } from "./contacts-panel";
import { ServiceAddressesPanel } from "./service-addresses-panel";

export const metadata = { title: "Customer" };

function timeAgo(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString("en-US");
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [customer, timeline, contacts] = await Promise.all([
    getCustomerById(id),
    getCustomerTimeline(id),
    getCustomerContacts(id),
  ]);

  if (!customer) {
    notFound();
  }

  return (
    <div className="max-w-3xl">
      <Link href="/desk/customers" className="text-sm text-gray-600 hover:underline">
        &larr; Back to customers
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {customer.user.name ?? customer.user.email}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {customer.user.email}
            {customer.phone ? ` · ${customer.phone}` : ""}
            {customer.companyName ? ` · ${customer.companyName}` : ""}
          </p>
        </div>

        {/* Quick actions — the two most common next steps from a
            customer's own page, without hunting through the nav. */}
        <div className="flex gap-2">
          <Link
            href={`/desk/agreements/new?customerId=${customer.id}`}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            + New agreement
          </Link>
          <Link
            href={`/desk/jobs/new?customerId=${customer.id}`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Schedule a job
          </Link>
          <Link
            href={`/desk/billing/customer/${customer.id}`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            View statement
          </Link>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
        <p className="text-sm text-gray-600">
          If this customer hasn&apos;t set their password yet, or says their
          activation email never arrived or expired, send it again:
        </p>
        <ResendActivationButton customerId={customer.id} />
      </div>

      <div className="mt-6">
        <ServiceAddressesPanel
          customerId={customer.id}
          addresses={customer.serviceAddresses}
          agreements={customer.rentalAgreements.map((a) => ({
            id: a.id,
            status: a.status,
            serviceAddressId: a.serviceAddressId,
            monthlyCents: a.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0),
          }))}
          jobs={customer.jobs.map((j) => ({ id: j.id, serviceAddressId: j.serviceAddressId }))}
        />
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="font-medium text-gray-900">Jobs</h2>
        {customer.jobs.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No jobs scheduled yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm text-gray-700">
            {customer.jobs.map((j) => (
              <li key={j.id}>
                <Link href={`/desk/jobs/${j.id}`} className="hover:underline">
                  {j.type} — {j.status}
                  {j.scheduledAt
                    ? ` (${new Date(j.scheduledAt).toLocaleDateString()})`
                    : ""}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-gray-900">Rental agreements</h2>
          <Link
            href={`/desk/agreements/new?customerId=${customer.id}`}
            className="text-sm text-primary hover:underline"
          >
            + New agreement
          </Link>
        </div>
        {customer.rentalAgreements.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No agreements yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {customer.rentalAgreements.map((a) => (
              <li key={a.id} className="py-2">
                <Link href={`/desk/agreements/${a.id}`} className="hover:underline">
                  {a.status} — {a.lines.length} appliance line(s)
                  {a.lines.length > 0 &&
                    ` (${formatCents(
                      a.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0),
                    )}/mo)`}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="font-medium text-gray-900">Referral program</h2>
        <p className="mt-2 text-sm text-gray-600">
          Their code: <span className="font-mono font-semibold text-gray-900">{customer.referralCode}</span>
          {" — "}give it to friends; when someone they refer signs up and starts
          paying, you both get a credit.
        </p>

        {customer.referredBy && (
          <p className="mt-2 text-sm text-gray-700">
            Referred by{" "}
            <Link
              href={`/desk/customers/${customer.referredBy.referrerCustomerId}`}
              className="hover:underline"
            >
              {customer.referredBy.referrerCustomer.user.name ?? customer.referredBy.referrerCustomer.user.email}
            </Link>{" "}
            — {customer.referredBy.status === "REWARDED" ? "reward already applied" : "reward pending (waiting for billing to start)"}
          </p>
        )}

        {customer.referralsMade.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium text-gray-900">People they&apos;ve referred</p>
            <ul className="mt-1 space-y-1 text-sm text-gray-700">
              {customer.referralsMade.map((r) => (
                <li key={r.id}>
                  <Link href={`/desk/customers/${r.referredCustomerId}`} className="hover:underline">
                    {r.referredCustomer.user.name ?? r.referredCustomer.user.email}
                  </Link>{" "}
                  — {r.status === "REWARDED" ? "reward applied" : "pending"}
                </li>
              ))}
            </ul>
          </div>
        )}

        {customer.credits.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium text-gray-900">Account credits</p>
            <ul className="mt-1 space-y-1 text-sm text-gray-700">
              {customer.credits.map((c) => (
                <li key={c.id}>
                  {formatCents(c.remainingCents)} remaining of {formatCents(c.amountCents)} — {c.reason}
                  {c.notes ? ` (${c.notes})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-6">
        <ContactsPanel customerId={customer.id} contacts={contacts} />
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="font-medium text-gray-900">Notes &amp; activity</h2>
        <AddNoteForm customerId={customer.id} />

        {timeline.length === 0 ? (
          <p className="mt-4 text-sm text-gray-600">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-4 space-y-3 border-t border-gray-100 pt-4">
            {timeline.map((entry) => (
              <li key={entry.id} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <p className={entry.kind === "note" ? "font-medium text-gray-900" : "text-gray-700"}>
                    {entry.kind === "note" ? "Note" : entry.summary}
                  </p>
                  <span className="shrink-0 text-xs text-gray-500">{timeAgo(entry.createdAt)}</span>
                </div>
                {entry.detail && <p className="text-gray-700">{entry.detail}</p>}
                {entry.authorName && (
                  <p className="text-xs text-gray-500">— {entry.authorName}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
