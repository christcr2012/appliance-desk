import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";

export type StripeInvoiceCashEvent = {
  amountCents: number;
  paymentIntentId: string;
  stripeChargeId: string | null;
  method: string;
  receivedOn: Date;
};

function paymentIntentId(payment: Stripe.InvoicePayment): string | null {
  const intent = payment.payment.payment_intent;
  if (!intent) return null;
  return typeof intent === "string" ? intent : intent.id;
}

function isPaid(payment: Stripe.InvoicePayment): boolean {
  // Runtime webhook fixtures and older expanded objects can omit status even
  // though current Stripe types include it. A known non-paid status is never
  // cash; an omitted status is accepted only because recordPaidInvoice is
  // called for an invoice Stripe already reports as paid.
  return !payment.status || payment.status === "paid";
}

async function listInvoicePayments(invoice: Stripe.Invoice): Promise<Stripe.InvoicePayment[]> {
  const embedded = invoice.payments?.data ?? [];
  if (invoice.payments && !invoice.payments.has_more) return embedded;

  const stripe = getStripeClient();
  const payments: Stripe.InvoicePayment[] = [];
  for await (const payment of stripe.invoicePayments.list({
    invoice: invoice.id,
    status: "paid",
    limit: 100,
  })) {
    payments.push(payment);
  }
  return payments;
}

/**
 * Resolve every real Stripe cash event that paid this invoice.
 *
 * Stripe models invoice-to-payment mappings as InvoicePayment objects. An
 * invoice can therefore be settled by multiple PaymentIntents/charges; using
 * invoice.amount_paid plus payments.data[0] would collapse distinct cash
 * events and lose provider/refund identity. We instead emit one normalized
 * event per paid InvoicePayment and paginate when Stripe says the embedded
 * list is incomplete.
 */
export async function resolveStripeInvoiceCashEvents(
  invoice: Stripe.Invoice,
): Promise<StripeInvoiceCashEvent[]> {
  const payments = (await listInvoicePayments(invoice)).filter(isPaid);
  const stripe = getStripeClient();
  const fallbackPaidAt = invoice.status_transitions?.paid_at
    ? new Date(invoice.status_transitions.paid_at * 1000)
    : new Date();

  const events: StripeInvoiceCashEvent[] = [];
  for (const payment of payments) {
    const intentId = paymentIntentId(payment);
    if (!intentId) {
      throw new Error(
        `Paid Stripe InvoicePayment ${payment.id} has no PaymentIntent; reconciliation is required.`,
      );
    }

    const amountCents =
      payment.amount_paid ??
      (payments.length === 1 && invoice.amount_paid > 0 ? invoice.amount_paid : null);
    if (!amountCents || amountCents <= 0) continue;

    const intent = await stripe.paymentIntents.retrieve(intentId, {
      expand: ["payment_method", "latest_charge"],
    });
    const methodObject = intent.payment_method;
    const method =
      methodObject && typeof methodObject !== "string"
        ? methodObject.type === "us_bank_account"
          ? "ach"
          : methodObject.type === "card"
            ? "card"
            : methodObject.type
        : "other";

    const latestCharge = intent.latest_charge;
    const charge = latestCharge
      ? typeof latestCharge === "string"
        ? await stripe.charges.retrieve(latestCharge)
        : latestCharge
      : null;

    const paidAt = payment.status_transitions?.paid_at
      ? new Date(payment.status_transitions.paid_at * 1000)
      : fallbackPaidAt;

    events.push({
      amountCents,
      paymentIntentId: intentId,
      stripeChargeId: charge?.id ?? null,
      method,
      receivedOn: charge?.created ? new Date(charge.created * 1000) : paidAt,
    });
  }

  return events;
}
