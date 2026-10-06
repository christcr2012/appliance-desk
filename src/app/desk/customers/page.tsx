import Link from "next/link";
import { getCustomersPage, getCustomersCount } from "@/domains/customers";
import { parsePage, paginationMeta } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import { ExportCsvLink } from "@/components/export-csv-link";
import {
  ButtonLink,
  DataList,
  EmptyState,
  PageHeader,
  StatusPill,
  type DataListColumn,
} from "@/components/ui";

export const metadata = { title: "Customers" };

type CustomerRow = Awaited<ReturnType<typeof getCustomersPage>>[number];

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: rawPage } = await searchParams;
  const totalCount = await getCustomersCount();
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const customers = await getCustomersPage(meta.skip, meta.pageSize);

  const columns: DataListColumn<CustomerRow>[] = [
    {
      key: "customer",
      header: "Customer",
      primary: true,
      cell: (customer) => (
        <div>
          <Link
            href={`/desk/customers/${customer.id}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            {customer.user.name ?? customer.user.email}
          </Link>
          {customer.companyName && (
            <span className="mt-1 block text-sm font-normal text-ink-soft">
              {customer.companyName}
            </span>
          )}
          {customer.isPropertyManager && (
            <span className="mt-2 block">
              <StatusPill tone="progress" label="Property manager" />
            </span>
          )}
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (customer) => customer.user.email,
    },
    {
      key: "agreements",
      header: "Agreements",
      cell: (customer) => String(customer._count.rentalAgreements),
    },
    {
      key: "properties",
      header: "Properties",
      cell: (customer) =>
        `${customer.serviceAddresses.length} ${customer.serviceAddresses.length === 1 ? "property" : "properties"}`,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Everyone renting from you. Website inquiries begin as leads; convert them there, or add a customer directly."
        primaryAction={{ href: "/desk/customers/new", label: "Add customer" }}
        secondaryActions={
          <ExportCsvLink href="/desk/customers/export" label="Export CSV" />
        }
      />

      {customers.length === 0 ? (
        <EmptyState
          title="No customers yet"
          description="Add someone directly, or convert your first lead."
          action={
            <ButtonLink href="/desk/customers/new" variant="secondary">
              Add customer
            </ButtonLink>
          }
        />
      ) : (
        <DataList
          rows={customers}
          columns={columns}
          caption="Customers"
          empty={null}
        />
      )}

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        totalCount={meta.totalCount}
        buildHref={(page) =>
          page === 1 ? "/desk/customers" : `/desk/customers?page=${page}`
        }
      />
    </div>
  );
}
