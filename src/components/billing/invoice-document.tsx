import Image from "next/image";
import type { InvoiceDetail } from "@/domains/billing/invoice-detail";
import { safeLogoUrl } from "@/domains/settings/profile-extras";
import { isSuccessfulPaymentStatus } from "@/domains/billing/payment-status";
import { formatCents } from "@/domains/pricing/money";
import { invoiceStatusLabel } from "@/lib/status-labels";

// A single invoice laid out like a real business document — logo and
// business info, a bill-to block, line items, and totals — instead of
// the app's other billing views, which are always a rollup/list. Chris
// asked for something "like Jobber's" invoices (2026-09-29 — see
// docs/DECISIONS.md's "Invoice document, Jobber-style" entry). Uses the
// same plain Tailwind gray/white classes as the rest of the owner desk
// and customer portal (not the CSS-variable token classes the public
// site uses) — see the long comment in src/app/globals.css explaining
// why: those plain classes are centrally retinted to the brand colors
// in both light and dark mode, and printed pages ignore @media
// (prefers-color-scheme) branches, so the `.dark` overrides in that
// file don't reach print output. print:* classes below strip anything
// that doesn't belong on paper (this page's own back link/print button,
// full-color chrome) and force plain black-on-white body text, which is
// both more legible for a receipt someone files away and saves the
// customer's printer ink — the header still prints in solid brand color
// since it's short and meant to be recognizable as this business's.

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

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  card: "Card",
  ach: "Bank transfer (ACH)",
  check: "Check",
  cash: "Cash",
  bank_transfer: "Bank transfer",
  other: "Other",
};

function formatDate(date: Date | null): string {
  return date ? new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—";
}

export function InvoiceDocument({ invoice }: { invoice: InvoiceDetail }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white print:rounded-none print:border-0 print:text-black">
      <div className="flex flex-wrap items-start justify-between gap-4 bg-gray-900 px-6 py-6 text-white print:bg-white print:px-0 print:pt-0 print:text-black">
        <div>
          {safeLogoUrl(invoice.business.logoUrl) && (
            <Image
              src={safeLogoUrl(invoice.business.logoUrl)!}
              alt={invoice.business.name}
              width={160}
              height={40}
              className="mb-2 h-10 w-auto rounded bg-white p-1 print:p-0"
            />
          )}
          <p className="text-lg font-semibold">{invoice.business.name}</p>
          <p className="mt-1 whitespace-pre-line text-sm opacity-90 print:opacity-100">{invoice.business.address}</p>
          <p className="text-sm opacity-90 print:opacity-100">
            {invoice.business.phone} · {invoice.business.email}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold tracking-wide">INVOICE</p>
          <p className="mt-1 font-mono text-sm opacity-90 print:opacity-100">#{invoice.invoiceNumber}</p>
          <p className="mt-2 text-sm opacity-90 print:opacity-100">Issued {formatDate(invoice.createdAt)}</p>
          {invoice.dueDate && <p className="text-sm opacity-90 print:opacity-100">Due {formatDate(invoice.dueDate)}</p>}
        </div>
      </div>

      <div className="px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Billed to</p>
            <p className="mt-1 font-medium text-gray-900">{invoice.customer.name}</p>
            {invoice.customer.companyName && <p className="text-sm text-gray-600">{invoice.customer.companyName}</p>}
            <p className="text-sm text-gray-600">{invoice.customer.email}</p>
            {invoice.propertyAddress && <p className="mt-1 text-sm text-gray-600">{invoice.propertyAddress}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</p>
            <span
              className={`mt-1 inline-block rounded-full px-3 py-1 text-sm font-medium ${
                STATUS_STYLES[invoice.status] ?? "bg-gray-100 text-gray-700"
              }`}
            >
              {invoiceStatusLabel(invoice.status)}
            </span>
            {invoice.billingPeriodStart && (
              <p className="mt-2 text-sm text-gray-600">
                For {formatDate(invoice.billingPeriodStart)}
                {invoice.billingPeriodEnd ? ` – ${formatDate(invoice.billingPeriodEnd)}` : ""}
              </p>
            )}
          </div>
        </div>

        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <th className="py-2">Description</th>
              <th className="py-2 text-center">Qty</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {invoice.lineItems.map((line) => (
              <tr key={line.id}>
                <td className="py-2.5 text-gray-900">{line.description}</td>
                <td className="py-2.5 text-center text-gray-600">{line.quantity}</td>
                <td className="py-2.5 text-right text-gray-900">{formatCents(line.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>{formatCents(invoice.subtotalCents)}</span>
            </div>
            {invoice.discountCents !== 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Discount</span>
                <span>−{formatCents(Math.abs(invoice.discountCents))}</span>
              </div>
            )}
            {invoice.taxCents > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Tax</span>
                <span>{formatCents(invoice.taxCents)}</span>
              </div>
            )}
            {invoice.lateFeeCents > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Late fee</span>
                <span>{formatCents(invoice.lateFeeCents)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-200 pt-1.5 font-medium text-gray-900">
              <span>Total due</span>
              <span>{formatCents(invoice.amountDueCents)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Paid</span>
              <span>{formatCents(invoice.amountPaidCents)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-1.5 text-base font-semibold text-gray-900">
              <span>Balance owed</span>
              <span>{formatCents(invoice.balanceCents)}</span>
            </div>
          </div>
        </div>

        {invoice.payments.length > 0 && (
          <div className="mt-8 border-t border-gray-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Payment history</p>
            <ul className="mt-2 divide-y divide-gray-100 text-sm">
              {invoice.payments.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between py-1.5">
                  <span className="text-gray-600">
                    {formatDate(payment.createdAt)} · {PAYMENT_METHOD_LABELS[payment.method ?? ""] ?? "Payment"}
                    {!isSuccessfulPaymentStatus(payment.status) ? ` (${payment.status})` : ""}
                  </span>
                  <span className="text-gray-900">{formatCents(payment.amountCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-8 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">
          {invoice.business.name} · {invoice.business.phone} · {invoice.business.email}
        </p>
      </div>
    </div>
  );
}
