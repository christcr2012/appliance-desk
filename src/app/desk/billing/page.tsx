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
import { StatusBadge } from "@/components/status-badge";
import { formatBusinessDate } from "@/lib/business-date";
import { PageHeader, FilterBar } from "@/components/desk/workspace";
import { invoiceStatusTone } from "@/lib/status-labels";

export const metadata = { title: "Billing" };

// OWNER/ADMIN only (docs/DECISIONS.md, 2026-09-28 "Staff permissions
// framework") — never rely on the nav link being hidden alone.
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { filter, page: rawPage } = await searchParams;
  const delinquentOnly = filter === "delinquent";
  const showStatements = filter === "statements";
  const invoiceFilter = { delinquentOnly };

  const totalCount = showStatements ? 0 : await getInvoicesCount(invoiceFilter);
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const [invoices, customerBalances] = await Promise.all([
    showStatements
      ? Promise.resolve([])
      : getInvoicesPage(invoiceFilter, meta.skip, meta.pageSize),
    showStatements ? getCustomersWithOpenBalances() : Promise.resolve([]),
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

  return (
    <div>
      <PageHeader
        title="Billing"
        description="Invoice snapshots and recorded payments. Rental rates, deposits and revenue are separate amounts."
      />
      <FilterBar
        label="Filter invoices"
        items={[
          {
            href: billingHref(1, null),
            label: "All invoices",
            active: !delinquentOnly && !showStatements,
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
        ]}
      />
      <p className="mb-4 text-sm text-ink-soft">
        An invoice status is the last recorded state. Pending payments may still
        be processing. Open a customer statement to review or record a manual
        payment.
      </p>

      {showStatements ? (
        customerBalances.length === 0 ? (
          <p className="mt-6 text-sm text-gray-600">
            No customer currently has an open balance.
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    className="px-4 py-2 text-left font-medium text-gray-600"
                  >
                    Customer
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-left font-medium text-gray-600"
                  >
                    Properties
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-right font-medium text-gray-600"
                  >
                    Open invoices
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-right font-medium text-gray-600"
                  >
                    Balance owed
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customerBalances.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2">
                      <Link
                        href={`/desk/billing/customer/${c.id}`}
                        className="text-gray-900 underline hover:no-underline"
                      >
                        {c.customerName}
                      </Link>
                      {c.isPropertyManager && (
                        <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                          Property manager
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {c.propertyCount}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600">
                      {c.openInvoiceCount}
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-amber-800">
                      {formatCents(c.balanceCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : invoices.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">
          {delinquentOnly
            ? "No delinquent invoices right now."
            : "No invoices yet — they're created automatically once a signed agreement's first Stripe payment goes through."}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-4 py-2 text-left font-medium text-gray-600"
                >
                  Invoice #
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-left font-medium text-gray-600"
                >
                  Customer
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-left font-medium text-gray-600"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-left font-medium text-gray-600"
                >
                  Period
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-right font-medium text-gray-600"
                >
                  Amount due
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-right font-medium text-gray-600"
                >
                  Amount paid
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">
                    <Link
                      className="text-primary underline"
                      href={`/desk/billing/customer/${invoice.customer.id}/invoice/${invoice.id}`}
                    >
                      #{invoice.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/desk/customers/${invoice.customer.id}`}
                      className="text-gray-900 underline hover:no-underline"
                    >
                      {invoice.customer.user.name ??
                        invoice.customer.user.email}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge
                      tone={invoiceStatusTone(invoice.status)}
                      label={invoice.status}
                      variant="pill"
                    />
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {invoice.billingPeriodStart
                      ? formatBusinessDate(invoice.billingPeriodStart)
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatCents(invoice.amountDueCents)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatCents(invoice.amountPaidCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination
            page={meta.page}
            totalPages={meta.totalPages}
            totalCount={meta.totalCount}
            buildHref={(p) => billingHref(p)}
          />
        </div>
      )}
    </div>
  );
}
