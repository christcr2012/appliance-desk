import Link from "next/link";
import { getInvoices, getCustomersWithOpenBalances } from "@/domains/billing";
import { formatCents } from "@/domains/pricing";
import { requireRole } from "@/lib/session";

export const metadata = { title: "Billing" };

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-green-100 text-green-800",
  DELINQUENT: "bg-red-100 text-red-800",
  FAILED: "bg-red-100 text-red-800",
  OPEN: "bg-yellow-100 text-yellow-800",
  PARTIALLY_PAID: "bg-yellow-100 text-yellow-800",
  WRITTEN_OFF: "bg-gray-200 text-gray-700",
  REFUNDED: "bg-blue-100 text-blue-800",
  VOID: "bg-gray-200 text-gray-700",
  DRAFT: "bg-gray-100 text-gray-600",
};

// OWNER/ADMIN only (docs/DECISIONS.md, 2026-09-28 "Staff permissions
// framework") — never rely on the nav link being hidden alone.
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { filter } = await searchParams;
  const delinquentOnly = filter === "delinquent";
  const showStatements = filter === "statements";
  const [invoices, customerBalances] = await Promise.all([
    showStatements ? Promise.resolve([]) : getInvoices({ delinquentOnly }),
    showStatements ? getCustomersWithOpenBalances() : Promise.resolve([]),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Billing</h1>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Every invoice Stripe has generated for a signed agreement. Card and
        bank-transfer payments are collected through Stripe&apos;s own
        hosted checkout automatically; a check, cash, or bank transfer is
        recorded by hand from a customer&apos;s own statement.
      </p>

      <nav aria-label="Filter invoices" className="mt-6 flex gap-2">
        <Link
          href="/desk/billing"
          className={`rounded-full px-3 py-1 text-sm ${
            !delinquentOnly && !showStatements ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          All invoices
        </Link>
        <Link
          href="/desk/billing?filter=delinquent"
          className={`rounded-full px-3 py-1 text-sm ${
            delinquentOnly ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Delinquent only
        </Link>
        <Link
          href="/desk/billing?filter=statements"
          className={`rounded-full px-3 py-1 text-sm ${
            showStatements ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          By customer (statements)
        </Link>
      </nav>

      {showStatements ? (
        customerBalances.length === 0 ? (
          <p className="mt-6 text-sm text-gray-600">No customer currently has an open balance.</p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Customer</th>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Properties</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium text-gray-600">Open invoices</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium text-gray-600">Balance owed</th>
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
                    <td className="px-4 py-2 text-gray-600">{c.propertyCount}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{c.openInvoiceCount}</td>
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
                <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Invoice #</th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Customer</th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Period</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-gray-600">Amount due</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-gray-600">Amount paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">#{invoice.invoiceNumber}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/desk/customers/${invoice.customer.id}`}
                      className="text-gray-900 underline hover:no-underline"
                    >
                      {invoice.customer.user.name ?? invoice.customer.user.email}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[invoice.status] ?? "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {invoice.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {invoice.billingPeriodStart
                      ? new Date(invoice.billingPeriodStart).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">{formatCents(invoice.amountDueCents)}</td>
                  <td className="px-4 py-2 text-right">{formatCents(invoice.amountPaidCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
