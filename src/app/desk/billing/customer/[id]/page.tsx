import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getCustomerStatement } from "@/domains/billing";
import { formatCents } from "@/domains/pricing/money";
import { invoiceStatusLabel } from "@/lib/status-labels";
import { ExportCsvLink } from "@/components/export-csv-link";
import { RecordPaymentForm } from "./record-payment-form";
import { WriteOffButton } from "./write-off-button";

export const metadata = { title: "Customer statement" };

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

/** The combined statement for one customer — every property, every
 * invoice, one running balance, instead of hunting through
 * /desk/billing's flat list for one customer's rows across however many
 * properties they have. See src/domains/billing/statements.ts. */
export default async function CustomerStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const statement = await getCustomerStatement(id);

  if (!statement) {
    notFound();
  }

  const openInvoices = statement.properties
    .flatMap((p) => p.invoices)
    .filter((inv) => inv.balanceCents > 0 && inv.status !== "WRITTEN_OFF")
    .map((inv) => ({ id: inv.id, invoiceNumber: inv.invoiceNumber, balanceCents: inv.balanceCents }));

  return (
    <div className="max-w-3xl">
      <Link href={`/desk/customers/${statement.customerId}`} className="text-sm text-gray-600 hover:underline">
        &larr; Back to customer
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{statement.customerName}</h1>
          {statement.companyName && <p className="text-sm text-gray-600">{statement.companyName}</p>}
        </div>
        <ExportCsvLink
          href={`/desk/billing/customer/${statement.customerId}/export`}
          label="Export statement (CSV)"
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Total billed</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{formatCents(statement.totalDueCents)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Total paid</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{formatCents(statement.totalPaidCents)}</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs text-amber-700">Balance owed</p>
          <p className="mt-1 text-lg font-semibold text-amber-900">{formatCents(statement.totalBalanceCents)}</p>
        </div>
      </div>

      <div className="mt-6">
        <RecordPaymentForm customerId={statement.customerId} openInvoices={openInvoices} />
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
              <div className="flex items-center justify-between">
                <h2 className="font-medium text-gray-900">{property.addressLabel}</h2>
                <span className="text-sm text-gray-600">
                  {property.totalBalanceCents > 0
                    ? `${formatCents(property.totalBalanceCents)} owed`
                    : "Paid up"}
                </span>
              </div>
              <ul className="mt-3 divide-y divide-gray-100">
                {property.invoices.map((invoice) => (
                  <li key={invoice.id} className="py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="font-mono text-xs text-gray-500">#{invoice.invoiceNumber}</span>{" "}
                        <span
                          className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            STATUS_STYLES[invoice.status] ?? "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {invoiceStatusLabel(invoice.status)}
                        </span>
                        {invoice.billingPeriodStart && (
                          <span className="ml-2 text-gray-600">
                            {new Date(invoice.billingPeriodStart).toLocaleDateString()}
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
                          <p className="text-gray-900">{formatCents(invoice.amountDueCents)} due</p>
                          {invoice.balanceCents > 0 && (
                            <p className="text-xs text-amber-700">{formatCents(invoice.balanceCents)} owed</p>
                          )}
                        </div>
                        {invoice.balanceCents > 0 && invoice.status !== "WRITTEN_OFF" && (
                          <WriteOffButton customerId={statement.customerId} invoiceId={invoice.id} />
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
    </div>
  );
}
