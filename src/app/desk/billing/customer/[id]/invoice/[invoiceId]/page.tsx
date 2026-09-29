import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getInvoiceDetail } from "@/domains/billing/invoice-detail";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { PrintInvoiceButton } from "@/components/billing/print-invoice-button";

export const metadata = { title: "Invoice" };

/** One invoice, on its own — the "Jobber-style" document Chris asked
 * for (2026-09-29, brand kit v2.0 phase 3, see docs/DECISIONS.md),
 * reached from a line on /desk/billing/customer/[id]'s statement.
 * OWNER/ADMIN can view any customer's invoice, same as the statement
 * page it's linked from. */
export default async function DeskInvoicePage({
  params,
}: {
  params: Promise<{ id: string; invoiceId: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { id, invoiceId } = await params;
  const invoice = await getInvoiceDetail(invoiceId);

  if (!invoice || invoice.customer.id !== id) {
    notFound();
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/desk/billing/customer/${id}`} className="text-sm text-gray-600 hover:underline">
          &larr; Back to statement
        </Link>
        <PrintInvoiceButton />
      </div>

      <div className="mt-4 print:mt-0">
        <InvoiceDocument invoice={invoice} />
      </div>
    </div>
  );
}
