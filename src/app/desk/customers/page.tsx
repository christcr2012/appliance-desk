import Link from "next/link";
import { getCustomers } from "@/domains/customers";

export const metadata = { title: "Customers" };

export default async function CustomersPage() {
  const customers = await getCustomers();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Customers</h1>
        <Link
          href="/desk/customers/new"
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          + Add customer
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Everyone renting from you. A website inquiry comes in as a lead first
        — convert it from the Leads page to turn it into a customer here, or
        add someone directly if you&apos;re signing them up yourself.
      </p>

      {customers.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">
          No customers yet — add one directly, or convert your first lead.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {customers.map((c) => (
            <li key={c.id}>
              <Link
                href={`/desk/customers/${c.id}`}
                className="flex flex-col gap-1 px-4 py-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {c.user.name ?? c.user.email}
                    {c.companyName ? ` — ${c.companyName}` : ""}
                    {c.isPropertyManager && (
                      <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary-dark">
                        Property manager
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-gray-600">{c.user.email}</p>
                </div>
                <div className="text-sm text-gray-500 sm:text-right">
                  <p>{c._count.rentalAgreements} agreement(s)</p>
                  <p>
                    {c.serviceAddresses.length}{" "}
                    {c.serviceAddresses.length === 1 ? "property" : "properties"}{" "}
                    on file
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
