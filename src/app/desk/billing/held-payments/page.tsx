import Link from "next/link";
import { requireRole } from "@/lib/session";
import { PageHeader } from "@/components/desk/workspace";
import { listHeldPayments } from "@/domains/billing/held-payments";
import { formatCents } from "@/domains/pricing";
import { formatBusinessDate } from "@/lib/business-date";
import { invoiceStatusLabel } from "@/lib/status-labels";
import { HeldPaymentCard } from "./held-payment-card";

export const metadata = { title: "Held payments" };

export default async function HeldPaymentsPage() {
  await requireRole("OWNER", "ADMIN");
  const held = await listHeldPayments();

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
    </div>
  );
}
