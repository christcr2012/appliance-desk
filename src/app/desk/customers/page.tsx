import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getWorkspace, savedViewHref } from "@/domains/workspace";
import { saveCustomerViewAction } from "@/app/desk/views/actions";
import { builtInViewsFor } from "@/components/kit/built-in-views";
import { Toolbar, type FilterDef } from "@/components/kit";
import { RecordTitleTransition } from "@/components/kit/record-title-transition";
import { getCustomersPage, getCustomersCount } from "@/domains/customers";
import { parsePage, paginationMeta } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import { ExportCsvLink } from "@/components/export-csv-link";
import { AutoRefresh } from "@/components/kit/auto-refresh";
import { PullToRefresh } from "@/components/kit/pull-to-refresh";
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
  searchParams: Promise<{ page?: string; status?: string; kind?: string; q?: string }>;
}) {
  const session = await requireRole("OWNER","ADMIN","STAFF");
  const { page: rawPage, status, kind, q } = await searchParams;
  const filters = { status: status === "active" ? "active" as const : undefined,
    kind: kind === "pm" ? "pm" as const : undefined,
    q: typeof q === "string" ? q.trim().slice(0,80) : undefined };
  const ownerOrAdmin = session.user.role === "OWNER" || session.user.role === "ADMIN";
  const workspace = ownerOrAdmin ? await getWorkspace(session.user.id) : null;
  const savedViews = workspace?.prefs.savedViews.filter(v => v.routeKey === "customers").map(v => ({ id:v.id,label:v.label,href:savedViewHref(v),builtIn:false })) ?? [];
  const totalCount = await getCustomersCount(filters);
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const customers = await getCustomersPage(meta.skip, meta.pageSize, filters);
  const urlParams = new URLSearchParams();
  if (filters.status) urlParams.set("status",filters.status);
  if (filters.kind) urlParams.set("kind",filters.kind);
  if (filters.q) urlParams.set("q",filters.q);
  const pageHref = (page: number) => {
    const next = new URLSearchParams(urlParams);
    if (page > 1) next.set("page", String(page));
    return "/desk/customers"+(next.size ? "?"+next.toString() : "");
  };


  const columns: DataListColumn<CustomerRow>[] = [
    {
      key: "customer",
      header: "Customer",
      primary: true,
      cell: (customer, surface) => (
        <div>
          <Link
            href={`/desk/customers/${customer.id}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            {surface === "mobile" ? (
              <RecordTitleTransition id={customer.id}>
                <span>{customer.user.name ?? customer.user.email}</span>
              </RecordTitleTransition>
            ) : (
              <span>{customer.user.name ?? customer.user.email}</span>
            )}
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
    <PullToRefresh><div>
      <AutoRefresh />
      <PageHeader
        title="Customers"
        description="Everyone renting from you. Website inquiries begin as leads; convert them there, or add a customer directly."
        primaryAction={{ href: "/desk/customers/new", label: "Add customer" }}
        secondaryActions={
          <ExportCsvLink href="/desk/customers/export" label="Export CSV" />
        }
      />

      <Toolbar
        search={{ label: "Search customers", placeholder: "Name, company or email" }}
        filters={[
          { kind: "select", param: "status", label: "Rental", options: [{value:"active",label:"Renting now"}] },
          { kind: "select", param: "kind", label: "Kind", options: [{value:"pm",label:"Property manager"}] },
        ] satisfies FilterDef[]}
        views={[...builtInViewsFor("customers"), ...savedViews]}
        currentViewId={filters.status === "active" && !filters.kind ? "renting-now" : undefined}
        saveViewAction={ownerOrAdmin ? saveCustomerViewAction : undefined}
        saveViewKeys={["status","kind"]}
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
        buildHref={pageHref}
      />
    </div></PullToRefresh>
  );
}
