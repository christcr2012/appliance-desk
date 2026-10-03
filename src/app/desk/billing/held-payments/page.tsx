import Link from "next/link";
import { requireRole } from "@/lib/session";
import { PageHeader } from "@/components/desk/workspace";
import { listHeldPayments, listHeldRefundsWaitingOnStripe } from "@/domains/billing/held-payments";
import { formatCents } from "@/domains/pricing";
import { formatBusinessDate } from "@/lib/business-date";
import { invoiceStatusLabel } from "@/lib/status-labels";
import { HeldPaymentCard } from "./held-payment-card";

export const metadata = { title: "Held payments" };

export default async function HeldPaymentsPage() {
  await requireRole("OWNER", "ADMIN");
  const [held, waiting] = await Promise.all([listHeldPayments(), listHeldRefundsWaitingOnStripe()]);

  return (
    <div>
      <PageHeader
        title="Held payments"
        description="Card payments that arrived after you had already written the invoice off or cancelled it. The money is recorded but waiting for your decision."
      />
      <p className="mb-4 text-sm text-ink-soft">
        <Link href="/desk/billing" className="font-medium text-brand hover:underline">
          Back to billing
        </Link>
      </p>

      <div className="mb-6 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800">
        <p className="font-medium text-gray-900">How this works</p>
        <p className="mt-1">
          Each payment below is real money that is not counted toward anything yet. For each one, pick what should
          happen: mark the invoice paid (the customer did owe it), keep it as credit for their next bills, or refund
          it to their card. The recommended choice is highlighted with the reason. You decide one payment at a time,
          and only the owner and admins can do this.
        </p>
      </div>

      {held.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-700">
          No payments are waiting for a decision.
        </div>
      ) : (
        <ul className="space-y-4">
          {held.map((h) => (
            <HeldPaymentCard
              key={h.id}
              paymentId={h.id}
              customerName={h.customerName}
              invoiceNumber={`#${h.invoiceNumber}`}
              invoiceStatusLabel={invoiceStatusLabel(h.invoiceStatus)}
              amountLabel={formatCents(h.amountCents)}
              receivedLabel={formatBusinessDate(h.receivedOn)}
              writtenOffReason={h.writtenOffReason}
              recommendation={h.recommendation}
              options={h.options}
            />
          ))}
        </ul>
      )}

      {waiting.length > 0 && (
        <section className="mt-8" aria-labelledby="waiting-refunds">
          <h2 id="waiting-refunds" className="text-base font-semibold text-gray-900">
            Refunds waiting on the card processor
          </h2>
          <p className="mt-1 text-sm text-gray-700">
            You decided to refund these, but the card processor has not confirmed them yet. They are retried
            automatically. If one stays here for more than a day, check{" "}
            <Link href="/desk/billing/reconciliation" className="font-medium text-brand hover:underline">
              billing reconciliation
            </Link>
            .
          </p>
          <ul className="mt-3 space-y-2 text-sm text-gray-800">
            {waiting.map((w) => (
              <li key={w.id} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                {formatCents(w.amountCents)} to {w.customerName} (invoice #{w.invoiceNumber})
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
