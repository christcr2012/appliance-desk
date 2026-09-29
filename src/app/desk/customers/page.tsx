import Link from "next/link";
import { getCustomersPage, getCustomersCount } from "@/domains/customers";
import { parsePage, paginationMeta } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import { ExportCsvLink } from "@/components/export-csv-link";
import { HomeServiceIcon } from "@/components/icons/service-icons";
import { PlusIcon } from "@/components/icons/status-icons";

export const metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: rawPage } = await searchParams;
  const totalCount = await getCustomersCount();
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const customers = await getCustomersPage(meta.skip, meta.pageSize);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <HomeServiceIcon className="h-5 w-5 text-gray-500" />
          Customers
        </h1>
        <div className="flex gap-2">
          <ExportCsvLink href="/desk/customers/export" label="Export CSV" />
          <Link
            href="/desk/customers/new"
            className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            <PlusIcon className="h-4 w-4" />
            Add customer
          </Link>
        </div>
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

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        totalCount={meta.totalCount}
        buildHref={(p) => (p === 1 ? "/desk/customers" : `/desk/customers?page=${p}`)}
      />
    </div>
  );
}
