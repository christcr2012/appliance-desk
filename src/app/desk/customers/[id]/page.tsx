import { notFound } from "next/navigation";
import Link from "next/link";
import { getCustomerById } from "@/domains/customers";
import { formatCents } from "@/domains/pricing";

export const metadata = { title: "Customer" };

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await getCustomerById(id);

  if (!customer) {
    notFound();
  }

  return (
    <div className="max-w-3xl">
      <Link href="/desk/customers" className="text-sm text-gray-600 hover:underline">
        &larr; Back to customers
      </Link>

      <h1 className="mt-2 text-xl font-semibold">
        {customer.user.name ?? customer.user.email}
      </h1>
      <p className="mt-1 text-sm text-gray-600">
        {customer.user.email}
        {customer.phone ? ` · ${customer.phone}` : ""}
        {customer.companyName ? ` · ${customer.companyName}` : ""}
      </p>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">Service addresses</h2>
          {customer.serviceAddresses.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">None on file.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm text-gray-700">
              {customer.serviceAddresses.map((a) => (
                <li key={a.id}>
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} {a.zip}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5">
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
    </div>
  );
}
