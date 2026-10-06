import Link from "next/link";
import {
  getInvoicesPage,
  getInvoicesCount,
  getCustomersWithOpenBalances,
} from "@/domains/billing";
import { formatCents } from "@/domains/pricing";
import { requireRole } from "@/lib/session";
import { parsePage, paginationMeta } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import { formatBusinessDate } from "@/lib/business-date";
import { FilterBar } from "@/components/desk/workspace";
import {
  DataList,
  EmptyState,
  PageHeader,
  StatusPill,
  type DataListColumn,
} from "@/components/ui";
import { invoiceStatusTone } from "@/lib/status-labels";
import { DepositsTab } from "./deposits-tab";
import { WaitingTab } from "./waiting-tab";

export const metadata = { title: "Billing" };

type InvoiceRow = Awaited<ReturnType<typeof getInvoicesPage>>[number];
type BalanceRow = Awaited<
  ReturnType<typeof getCustomersWithOpenBalances>
>[number];

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { filter, page: rawPage } = await searchParams;
  const delinquentOnly = filter === "delinquent";
  const showStatements = filter === "statements";
  const showDeposits = filter === "deposits";
  const showWaiting = filter === "waiting";
  const otherTab = showDeposits || showWaiting;
  const invoiceFilter = { delinquentOnly };

  const totalCount =
    showStatements || otherTab
      ? 0
      : await getInvoicesCount(invoiceFilter);
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const [invoices, customerBalances] = await Promise.all([
    showStatements || otherTab
      ? Promise.resolve([])
      : getInvoicesPage(invoiceFilter, meta.skip, meta.pageSize),
    showStatements
      ? getCustomersWithOpenBalances()
      : Promise.resolve([]),
  ]);

  function billingHref(
    page: number,
    forFilter: string | null = filter ?? null,
  ) {
    const params = new URLSearchParams();
    if (forFilter) params.set("filter", forFilter);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/desk/billing?${qs}` : "/desk/billing";
  }

  const invoiceColumns: DataListColumn<InvoiceRow>[] = [
    {
      key: "invoice",
      header: "Invoice",
      primary: true,
      cell: (invoice) => (
        <Link
          href={`/desk/billing/customer/${invoice.customer.id}/invoice/${invoice.id}`}
          className="font-semibold text-ink underline-offset-4 hover:underline"
        >
          #{invoice.invoiceNumber}
        </Link>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (invoice) => (
        <Link
          href={`/desk/customers/${invoice.customer.id}`}
          className="font-medium text-ink underline-offset-4 hover:underline"
        >
          {invoice.customer.user.name ?? invoice.customer.user.email}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (invoice) => (
        <StatusPill
          tone={invoiceStatusTone(invoice.status)}
          label={invoice.status}
        />
      ),
    },
    {
      key: "period",
      header: "Period",
      cell: (invoice) =>
        invoice.billingPeriodStart
          ? formatBusinessDate(invoice.billingPeriodStart)
          : "—",
    },
    {
      key: "due",
      header: "Amount due",
      cell: (invoice) => formatCents(invoice.amountDueCents),
    },
    {
      key: "paid",
      header: "Amount paid",
      cell: (invoice) => formatCents(invoice.amountPaidCents),
    },
  ];

  const balanceColumns: DataListColumn<BalanceRow>[] = [
    {
      key: "customer",
      header: "Customer",
      primary: true,
      cell: (customer) => (
        <div>
          <Link
            href={`/desk/billing/customer/${customer.id}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            {customer.customerName}
          </Link>
          {customer.isPropertyManager && (
            <span className="mt-2 block">
              <StatusPill tone="progress" label="Property manager" />
            </span>
          )}
        </div>
      ),
    },
    {
      key: "properties",
      header: "Properties",
      cell: (customer) => String(customer.propertyCount),
    },
    {
      key: "invoices",
      header: "Open invoices",
      cell: (customer) => String(customer.openInvoiceCount),
    },
    {
      key: "balance",
      header: "Balance owed",
      cell: (customer) => (
        <span className="font-semibold text-warning-ink">
          {formatCents(customer.balanceCents)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Billing"
        description="Invoice snapshots and recorded payments. Rental rates, deposits, and revenue are separate amounts."
      />

      <FilterBar
        label="Filter invoices"
        items={[
          {
            href: billingHref(1, null),
            label: "All invoices",
            active: !delinquentOnly && !showStatements && !otherTab,
          },
          {
            href: billingHref(1, "delinquent"),
            label: "Delinquent only",
            active: delinquentOnly,
          },
          {
            href: billingHref(1, "statements"),
            label: "By customer (statements)",
            active: showStatements,
          },
          {
            href: billingHref(1, "deposits"),
            label: "Deposits",
            active: showDeposits,
          },
          {
            href: billingHref(1, "waiting"),
            label: "Waiting for Stripe",
            active: showWaiting,
          },
          {
            href: "/desk/billing/held-payments",
            label: "Held payments",
            active: false,
          },
          {
            href: "/desk/billing/reconciliation",
            label: "Reconciliation",
            active: false,
          },
        ]}
      />

      <p className="mb-4 text-sm text-ink-soft">
        An invoice status is the last recorded state. Pending payments may
        still be processing. Open a customer statement to review or record a
        manual payment.
      </p>

      {showDeposits ? (
        <DepositsTab />
      ) : showWaiting ? (
        <WaitingTab />
      ) : showStatements ? (
        <DataList
          rows={customerBalances}
          columns={balanceColumns}
          caption="Customer open balances"
          empty={
            <EmptyState
              title="No open customer balances"
              description="No customer currently has an open balance."
            />
          }
        />
      ) : (
        <>
          <DataList
            rows={invoices}
            columns={invoiceColumns}
            caption="Invoices"
            empty={
              <EmptyState
                title={
                  delinquentOnly
                    ? "No delinquent invoices right now"
                    : "No invoices yet"
                }
                description={
                  delinquentOnly
                    ? "Nothing currently needs delinquent-invoice follow-up."
                    : "Invoices are created automatically after a signed agreement's first Stripe payment succeeds."
                }
              />
            }
          />
          {invoices.length > 0 && (
            <Pagination
              page={meta.page}
              totalPages={meta.totalPages}
              totalCount={meta.totalCount}
              buildHref={(page) => billingHref(page)}
            />
          )}
        </>
      )}
    </div>
  );
}
