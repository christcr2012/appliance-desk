import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import { getInvoiceDetail } from "@/domains/billing/invoice-detail";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { PrintDocumentButton } from "@/components/print-document-button";

export const metadata = { title: "Invoice" };

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
      <div className="flex items-center justify-between print:hidden">
        <Link href="/account/billing" className="text-sm text-gray-600 hover:underline">
          &larr; Back to billing
        </Link>
        <PrintDocumentButton />
      </div>

      <div className="mt-4 print:mt-0">
        <InvoiceDocument invoice={invoice} />
      </div>
    </div>
  );
}
