import { requireRole } from "@/lib/session";
import {
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import {
  listHeldPayments,
  listHeldRefundsWaitingOnStripe,
} from "@/domains/billing/held-payments";
import { formatCents } from "@/domains/pricing";
import { formatBusinessDate } from "@/lib/business-date";
import { invoiceStatusLabel } from "@/lib/status-labels";
import { HeldPaymentCard } from "./held-payment-card";

export const metadata = { title: "Held payments" };

export default async function HeldPaymentsPage() {
  await requireRole("OWNER", "ADMIN");
  const [held, waiting] = await Promise.all([
    listHeldPayments(),
    listHeldRefundsWaitingOnStripe(),
  ]);

  return (
    <div>
      <PageHeader
        title="Held payments"
        description="Card payments that arrived after an invoice had already been written off or cancelled. The money is recorded but waits for an owner/admin decision."
        secondaryActions={
          <ButtonLink href="/desk/billing" variant="secondary">
            Back to billing
          </ButtonLink>
        }
      />

      <div className="mb-6">
        <Card title="How this works">
          <p className="text-sm text-ink-soft">
            Each payment below is real money that is not counted toward
            anything yet. For each one, choose whether to restore and mark the
            invoice paid, keep the money as customer credit, or refund it to the
            original card. The recommended choice includes its reason. You
            decide one payment at a time, and only owners/admins can do this.
          </p>
        </Card>
      </div>

      {held.length === 0 ? (
        <EmptyState
          title="No payments are waiting for a decision"
          description="Late-arriving card payments will appear here if they need owner/admin review."
        />
      ) : (
        <ul className="space-y-4">
          {held.map((payment) => (
            <HeldPaymentCard
              key={payment.id}
              paymentId={payment.id}
              customerName={payment.customerName}
              invoiceNumber={`#${payment.invoiceNumber}`}
              invoiceStatusLabel={invoiceStatusLabel(payment.invoiceStatus)}
              amountLabel={formatCents(payment.amountCents)}
              receivedLabel={formatBusinessDate(payment.receivedOn)}
              writtenOffReason={payment.writtenOffReason}
              recommendation={payment.recommendation}
              options={payment.options}
            />
          ))}
        </ul>
      )}

      {waiting.length > 0 && (
        <div className="mt-8">
          <Card
            title="Refunds waiting on the card processor"
            description="You already chose to refund these payments, but the card processor has not confirmed them yet. They retry automatically."
            actions={
              <ButtonLink
                href="/desk/billing/reconciliation"
                variant="secondary"
              >
                Billing reconciliation
              </ButtonLink>
            }
          >
            <ul className="divide-y divide-line text-sm text-ink">
              {waiting.map((refund) => (
                <li key={refund.id} className="py-3">
                  {formatCents(refund.amountCents)} to {refund.customerName}{" "}
                  (invoice #{refund.invoiceNumber})
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
