import { formatBusinessDate } from "@/lib/business-date";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getCustomerStatement } from "@/domains/billing";
import { formatCents } from "@/domains/pricing/money";
import { invoiceStatusLabel, invoiceStatusTone } from "@/lib/status-labels";
import { ExportCsvLink } from "@/components/export-csv-link";
import { StatusBadge } from "@/components/status-badge";
import { RecordPaymentForm } from "./record-payment-form";
import { WriteOffButton } from "./write-off-button";

export const metadata = { title: "Customer statement" };

export default async function CustomerStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const statement = await getCustomerStatement(id);

  if (!statement) notFound();

  const openInvoices = statement.properties
    .flatMap((property) => property.invoices)
    .filter((invoice) => invoice.balanceCents > 0 && invoice.status !== "WRITTEN_OFF")
    .map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      balanceCents: invoice.balanceCents,
    }));

  const reconciliation = statement.reconciliation;

  return (
    <div className="max-w-3xl">
      <Link
        href={`/desk/customers/${statement.customerId}`}
        className="text-sm text-gray-600 hover:underline"
      >
        &larr; Back to customer
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{statement.customerName}</h1>
          {statement.companyName && (
            <p className="text-sm text-gray-600">{statement.companyName}</p>
          )}
        </div>
        <ExportCsvLink
          href={`/desk/billing/customer/${statement.customerId}/export`}
          label="Export statement (CSV)"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Total billed</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">
            {formatCents(statement.totalDueCents)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Net applied</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">
            {formatCents(statement.totalPaidCents)}
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs text-amber-700">Balance owed</p>
          <p className="mt-1 text-lg font-semibold text-amber-900">
            {formatCents(statement.totalBalanceCents)}
          </p>
        </div>
      </div>

      <p className="mt-4 text-sm text-ink-soft">
        Invoice balances are reconstructed from receipt allocations, applied
        credits and refunds instead of trusting a single cached paid-total
        field. Whole unallocated overpayments remain visible in the cash ledger
        but do not reduce an invoice until allocated or applied as credit.
      </p>

      <div className="mt-6">
        <RecordPaymentForm
          customerId={statement.customerId}
          openInvoices={openInvoices}
        />
      </div>

      {statement.properties.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">No invoices on file yet.</p>
      ) : (
        <div className="mt-6 space-y-6">
          {statement.properties.map((property) => (
            <div
              key={property.serviceAddressId ?? "no-property"}
              className="rounded-lg border border-gray-200 bg-white p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="font-medium text-gray-900">
                  {property.addressLabel}
                </h2>
                <span className="text-sm text-gray-600">
                  {property.totalBalanceCents > 0
                    ? `${formatCents(property.totalBalanceCents)} owed`
                    : "Paid up"}
                </span>
              </div>
              <ul className="mt-3 divide-y divide-gray-100">
                {property.invoices.map((invoice) => (
                  <li key={invoice.id} className="py-2 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`/desk/billing/customer/${statement.customerId}/invoice/${invoice.id}`}
                          className="font-mono text-xs text-gray-500 hover:underline"
                        >
                          #{invoice.invoiceNumber}
                        </Link>{" "}
                        <StatusBadge
                          tone={invoiceStatusTone(invoice.status)}
                          label={invoiceStatusLabel(invoice.status)}
                          variant="pill"
                          className="ml-1"
                        />
                        {invoice.billingPeriodStart && (
                          <span className="ml-2 text-gray-600">
                            {formatBusinessDate(invoice.billingPeriodStart)}
                          </span>
                        )}
                        {invoice.lateFeeCents > 0 && (
                          <span className="ml-2 text-xs text-red-700">
                            includes {formatCents(invoice.lateFeeCents)} late fee
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-right">
                        <div>
                          <p className="text-gray-900">
                            {formatCents(invoice.amountDueCents)} due
                          </p>
                          {invoice.balanceCents > 0 && (
                            <p className="text-xs text-amber-700">
                              {formatCents(invoice.balanceCents)} owed
                            </p>
                          )}
                        </div>
                        {invoice.balanceCents > 0 &&
                          invoice.status !== "WRITTEN_OFF" && (
                            <WriteOffButton
                              customerId={statement.customerId}
                              invoiceId={invoice.id}
                            />
                          )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="font-medium text-gray-900">Statement reconciliation</h2>
        <p className="mt-1 text-sm text-gray-600">
          Opening balance + invoices − receipt allocations − applied credits +
          refunds = closing balance.
        </p>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt>Opening balance</dt>
            <dd>{formatCents(reconciliation.openingBalanceCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Invoice charges</dt>
            <dd>{formatCents(reconciliation.invoiceChargesCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Receipt allocations</dt>
            <dd>−{formatCents(reconciliation.receiptAllocationsCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Credits applied</dt>
            <dd>−{formatCents(reconciliation.creditsAppliedCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Refunds</dt>
            <dd>+{formatCents(reconciliation.refundsCents)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-gray-200 pt-2 font-semibold sm:border-t-0 sm:pt-0">
            <dt>Closing balance</dt>
            <dd>{formatCents(reconciliation.closingBalanceCents)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
