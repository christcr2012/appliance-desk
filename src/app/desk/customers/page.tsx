import Link from "next/link";
import { getCustomers } from "@/domains/customers";

export const metadata = { title: "Customers" };

export default async function CustomersPage() {
  const customers = await getCustomers();

  return (
    <div>
      <h1 className="text-xl font-semibold">Customers</h1>
      <p className="mt-1 text-sm text-gray-600">
        Everyone who&apos;s been converted from a lead. To add a new one,
        convert a lead from <Link href="/desk/leads" className="underline">/desk/leads</Link>.
      </p>

      {customers.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">
          No customers yet — convert your first lead to get started.
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
                  </p>
                  <p className="text-sm text-gray-600">{c.user.email}</p>
                </div>
                <div className="text-sm text-gray-500 sm:text-right">
                  <p>{c._count.rentalAgreements} agreement(s)</p>
                  <p>{c.serviceAddresses.length} address(es) on file</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
