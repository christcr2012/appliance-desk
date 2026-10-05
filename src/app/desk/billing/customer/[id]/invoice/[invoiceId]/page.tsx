import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getInvoiceDetail } from "@/domains/billing/invoice-detail";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { PrintDocumentButton } from "@/components/print-document-button";
import { prisma } from "@/lib/prisma";
import { getSpendableCredits } from "@/domains/billing/money-decisions";
import { MoneyDecisionForm } from "@/components/desk/money-decision-form";
import { applyCreditAction, refundInvoiceAction } from "@/app/desk/billing/money-actions";
import { formatCents } from "@/domains/pricing";

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

  const money = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true, amountDueCents: true, amountPaidCents: true, refunds: { select: { amountCents: true } } },
  });
  const refundable = money ? money.amountPaidCents - money.refunds.reduce((sum, r) => sum + r.amountCents, 0) : 0;
  const outstanding = money ? Math.max(0, money.amountDueCents - money.amountPaidCents) : 0;
  const isOpen = money ? ["OPEN", "PARTIALLY_PAID", "DELINQUENT"].includes(money.status) : false;
  const credits = isOpen && outstanding > 0 ? await getSpendableCredits(id) : [];

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/desk/billing/customer/${id}`} className="text-sm text-gray-600 hover:underline">
          &larr; Back to statement
        </Link>
        <PrintDocumentButton />
      </div>

      <div className="mt-4 print:mt-0">
        <InvoiceDocument invoice={invoice} />
      </div>

      <section aria-labelledby="money-decisions" className="mt-8 space-y-4 print:hidden">
        <h2 id="money-decisions" className="text-lg font-semibold text-gray-900">
          Money decisions for this invoice
        </h2>
        <p className="text-sm text-gray-600">
          Refunds and credits are your decisions. Nothing here happens by itself. If a late pickup was our delay, record
          that on the pickup job instead (Jobs, then the job, then the late-pickup section) so the late days are waived.
        </p>
        {refundable > 0 ? (
          <MoneyDecisionForm
            title="Refund money to the customer"
            help={`Up to ${formatCents(refundable)} can still be refunded on this invoice. Money paid through Stripe goes back to the original card or bank; money paid another way is recorded for you to pay back yourself.`}
            verb="refund"
            maxCents={refundable}
            selectLabel="Why is this being refunded?"
            options={[
              { value: "OVERPAYMENT", label: "The customer paid too much" },
              { value: "BILLING_ERROR", label: "We billed in error" },
              { value: "GOODWILL", label: "Goodwill" },
              { value: "DISPUTE_RESOLUTION", label: "Settling a disagreement" },
              { value: "OTHER", label: "Something else" },
            ]}
            reasonLabel="A short note for the record"
            reasonRequired
            submitLabel="Refund this money"
            submit={refundInvoiceAction.bind(null, invoiceId)}
          />
        ) : (
          <p className="text-sm text-gray-600">Nothing has been paid on this invoice that could still be refunded.</p>
        )}
        {credits.length > 0 && (
          <MoneyDecisionForm
            title="Pay this invoice with the customer's credit"
            help={`The invoice still owes ${formatCents(outstanding)}. Using credit lowers what the customer owes; no money moves.`}
            verb="apply"
            maxCents={outstanding}
            selectLabel="Which credit?"
            options={credits.map((c) => ({
              value: c.id,
              label: `${formatCents(c.remainingCents)} left — ${c.reason}`,
            }))}
            submitLabel="Apply this credit"
            submit={applyCreditAction.bind(null, invoiceId)}
          />
        )}
      </section>
    </div>
  );
}
