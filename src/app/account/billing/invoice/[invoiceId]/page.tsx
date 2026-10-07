import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import { getInvoiceDetail } from "@/domains/billing/invoice-detail";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { PrintDocumentButton } from "@/components/print-document-button";
import { ButtonLink } from "@/components/ui";

export const metadata = { title: "Invoice" };

const FINAL_INVOICE_STATUSES = new Set(["PAID", "VOID", "WRITTEN_OFF", "REFUNDED"]);

/** A customer's own invoice, laid out as a real document (2026-09-29,
 * brand kit v2.0 phase 3 — see docs/DECISIONS.md), reached from a line
 * on /account/billing. getInvoiceDetail is called with this customer's
 * own id, so an invoice belonging to anyone else comes back null —
 * same customer-data-isolation guarantee as the rest of the portal
 * (see tests/customer-isolation.test.ts). */
export default async function AccountInvoicePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const session = await requireSession();
  const { invoiceId } = await params;
  const customer = await getPortalData(session.user.id);

  if (!customer) {
    notFound();
  }

  const invoice = await getInvoiceDetail(invoiceId, { customerId: customer.id });

  if (!invoice) {
    notFound();
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <ButtonLink href="/account/billing" variant="quiet">
          Back to billing
        </ButtonLink>
        <div className="flex flex-wrap items-center gap-3">
          {FINAL_INVOICE_STATUSES.has(invoice.status) && (
            <ButtonLink
              href={`/api/documents/invoice/${invoiceId}`}
              target="_blank"
              variant="secondary"
            >
              View frozen invoice record
            </ButtonLink>
          )}
          <PrintDocumentButton />
        </div>
      </div>

      {invoice.isLocalInvoice && invoice.balanceCents > 0 && (
        <div className="mt-4 rounded-xl border border-line bg-surface-subtle p-4 text-sm text-ink print:hidden">
          <p className="font-semibold">Pay as arranged with Robinson Appliance Rentals.</p>
          <p className="mt-1 text-ink-soft">
            This invoice is recorded in Appliance Desk, but card payment for local invoices is not enabled yet.
          </p>
        </div>
      )}

      <div className="mt-4 print:mt-0">
        <InvoiceDocument invoice={invoice} />
      </div>
    </div>
  );
}
