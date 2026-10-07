import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { SUCCESSFUL_PAYMENT_STATUSES } from "./payment-status";
import {
  resolveStripeInvoiceCashEvents,
  type StripeInvoiceCashEvent,
} from "./stripe-invoice-payments";

/**
 * R08 — provider evidence for one Stripe webhook event.
 *
 * Everything a webhook handler needs from Stripe is fetched HERE, before the
 * short local transaction opens, so no network call ever waits while the global
 * webhook lock or any row lock is held. The transaction then reads only from
 * this object.
 *
 * Evidence is evidence, not authority: it is a snapshot of what Stripe said. The
 * handlers still re-read and re-check local rows under their locks before they
 * change anything. If a handler needs a piece of evidence that was not gathered
 * (because local state changed between the early check and the lock), it throws
 * `MissingWebhookEvidenceError`; the caller fetches exactly that item, outside
 * any lock, and replays the local transaction.
 */

export type PaymentDetails = {
  method: string | null;
  stripeChargeId: string | null;
  receivedOn: Date;
  amountReceivedCents: number | null;
};

export class MissingWebhookEvidenceError extends Error {
  constructor(readonly key: string) {
    super(`Stripe evidence "${key}" was not gathered before the webhook transaction.`);
    this.name = "MissingWebhookEvidenceError";
  }
}

export function idOf(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export function extractSubscriptionId(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
}

/**
 * Resolve the provider facts for one successful PaymentIntent. Receipt dates
 * use the Stripe charge's creation instant when available, not our webhook
 * processing time. That gives reports the provider-effective date basis.
 */
async function fetchPaymentDetails(
  paymentIntentId: string,
  fallbackReceivedOn = new Date(),
): Promise<PaymentDetails> {
  const stripe = getStripeClient();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["payment_method", "latest_charge"],
  });

  const paymentMethod = intent.payment_method;
  let method: string | null = null;
  if (paymentMethod && typeof paymentMethod !== "string") {
    method =
      paymentMethod.type === "us_bank_account"
        ? "ach"
        : paymentMethod.type === "card"
          ? "card"
          : paymentMethod.type;
  }

  const latestCharge = intent.latest_charge;
  let charge: Stripe.Charge | null = null;
  if (latestCharge) {
    charge =
      typeof latestCharge === "string"
        ? await stripe.charges.retrieve(latestCharge)
        : latestCharge;
  }

  return {
    method,
    stripeChargeId: charge?.id ?? null,
    receivedOn: charge?.created ? new Date(charge.created * 1000) : fallbackReceivedOn,
    amountReceivedCents: Number.isInteger(intent.amount_received)
      ? intent.amount_received
      : null,
  };
}

export class WebhookEvidence {
  private readonly intentsWithMethod = new Map<string, Stripe.PaymentIntent>();
  private readonly details = new Map<string, PaymentDetails>();
  private readonly invoices = new Map<string, Stripe.Invoice>();
  private readonly setupIntents = new Map<string, Stripe.SetupIntent>();
  private readonly cash = new Map<string, StripeInvoiceCashEvent[]>();

  // ---- reads used inside the local transaction (never touch the network) ----

  paymentIntentWithMethod(id: string): Stripe.PaymentIntent {
    return this.need(this.intentsWithMethod, id, "intent");
  }

  paymentDetails(id: string): PaymentDetails {
    return this.need(this.details, id, "details");
  }

  invoice(id: string): Stripe.Invoice {
    return this.need(this.invoices, id, "invoice");
  }

  setupIntent(id: string): Stripe.SetupIntent {
    return this.need(this.setupIntents, id, "setup");
  }

  cashEvents(stripeInvoiceId: string): StripeInvoiceCashEvent[] {
    return this.need(this.cash, stripeInvoiceId, "cash");
  }

  private need<T>(map: Map<string, T>, id: string, kind: string): T {
    const value = map.get(id);
    if (value === undefined) throw new MissingWebhookEvidenceError(`${kind}:${id}`);
    return value;
  }

  // ---- fetches used ONLY before the transaction opens ----

  async fetchPaymentIntentWithMethod(id: string): Promise<void> {
    if (this.intentsWithMethod.has(id)) return;
    const stripe = getStripeClient();
    this.intentsWithMethod.set(
      id,
      await stripe.paymentIntents.retrieve(id, { expand: ["payment_method"] }),
    );
  }

  async fetchPaymentDetails(id: string): Promise<void> {
    if (this.details.has(id)) return;
    this.details.set(id, await fetchPaymentDetails(id));
  }

  async fetchInvoice(id: string): Promise<Stripe.Invoice> {
    const known = this.invoices.get(id);
    if (known) return known;
    const stripe = getStripeClient();
    const invoice = await stripe.invoices.retrieve(id, { expand: ["payments"] });
    this.invoices.set(id, invoice);
    return invoice;
  }

  async fetchSetupIntent(id: string): Promise<void> {
    if (this.setupIntents.has(id)) return;
    const stripe = getStripeClient();
    this.setupIntents.set(id, await stripe.setupIntents.retrieve(id));
  }

  async fetchCashEvents(invoice: Stripe.Invoice): Promise<void> {
    if (this.cash.has(invoice.id as string)) return;
    this.cash.set(invoice.id as string, await resolveStripeInvoiceCashEvents(invoice));
  }

  /** Fetch exactly the item a handler reported missing (outside any lock). */
  async fill(key: string): Promise<void> {
    const separator = key.indexOf(":");
    const kind = key.slice(0, separator);
    const id = key.slice(separator + 1);
    switch (kind) {
      case "intent":
        return this.fetchPaymentIntentWithMethod(id);
      case "details":
        return this.fetchPaymentDetails(id);
      case "invoice":
        await this.fetchInvoice(id);
        return;
      case "setup":
        return this.fetchSetupIntent(id);
      case "cash":
        return this.fetchCashEvents(await this.fetchInvoice(id));
      default:
        throw new Error(`Unknown webhook evidence key "${key}".`);
    }
  }
}

async function hasSuccessfulPaymentForIntent(paymentIntentId: string): Promise<boolean> {
  const existing = await prisma.payment.findFirst({
    where: {
      stripePaymentIntentId: paymentIntentId,
      status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] },
    },
    select: { id: true },
  });
  return existing !== null;
}

async function gatherEstimateDepositEvidence(
  evidence: WebhookEvidence,
  estimateId: string,
  paymentIntentId: string,
  options: { fetchMethod: boolean; paid: boolean },
): Promise<void> {
  const estimate = await prisma.estimate.findUnique({
    where: { id: estimateId },
    select: { customerId: true, depositCents: true, depositPaidAt: true },
  });
  if (!estimate?.customerId) return;
  if (options.fetchMethod) await evidence.fetchPaymentIntentWithMethod(paymentIntentId);
  if (options.paid && !estimate.depositPaidAt && estimate.depositCents > 0) {
    await evidence.fetchPaymentDetails(paymentIntentId);
  }
}

async function gatherPaidInvoiceEvidence(
  evidence: WebhookEvidence,
  stripeInvoiceId: string,
): Promise<void> {
  const invoice = await evidence.fetchInvoice(stripeInvoiceId);
  await evidence.fetchCashEvents(invoice);
}

async function gatherCheckoutCompleted(
  evidence: WebhookEvidence,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const estimateId = session.metadata?.estimateId;
  if (estimateId) {
    const paymentIntentId = idOf(session.payment_intent);
    if (!paymentIntentId) return;
    await gatherEstimateDepositEvidence(evidence, estimateId, paymentIntentId, {
      fetchMethod: true,
      paid: session.payment_status === "paid",
    });
    return;
  }

  const agreementId = session.metadata?.agreementId;
  if (!agreementId) return;

  if (session.mode === "subscription") {
    const invoiceId = idOf(session.invoice);
    if (!invoiceId) return;
    const invoice = await evidence.fetchInvoice(invoiceId);
    if (invoice.status === "paid") await evidence.fetchCashEvents(invoice);
    return;
  }

  if (session.mode === "setup") {
    const setupIntentId = idOf(session.setup_intent);
    if (setupIntentId) await evidence.fetchSetupIntent(setupIntentId);
    return;
  }

  if (session.mode === "payment") {
    const paymentIntentId = idOf(session.payment_intent);
    if (!paymentIntentId) return;
    await evidence.fetchPaymentIntentWithMethod(paymentIntentId);
    if (
      session.payment_status === "paid" &&
      !(await hasSuccessfulPaymentForIntent(paymentIntentId))
    ) {
      await evidence.fetchPaymentDetails(paymentIntentId);
    }
  }
}

async function gatherAsyncPaymentSucceeded(
  evidence: WebhookEvidence,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const paymentIntentId = idOf(session.payment_intent);
  if (!paymentIntentId) return;

  const estimateId = session.metadata?.estimateId;
  if (estimateId) {
    await gatherEstimateDepositEvidence(evidence, estimateId, paymentIntentId, {
      fetchMethod: false,
      paid: true,
    });
    return;
  }

  if (!session.metadata?.agreementId) return;
  if (!(await hasSuccessfulPaymentForIntent(paymentIntentId))) {
    await evidence.fetchPaymentDetails(paymentIntentId);
  }
}

async function gatherInvoicePaid(
  evidence: WebhookEvidence,
  webhookInvoice: Stripe.Invoice,
): Promise<void> {
  const subscriptionId = extractSubscriptionId(webhookInvoice);
  if (!subscriptionId) return;
  const agreement = await prisma.rentalAgreement.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true },
  });
  if (!agreement) return;
  const recorded = await prisma.invoice.findUnique({
    where: { stripeInvoiceId: webhookInvoice.id },
    select: { status: true },
  });
  if (recorded?.status === "PAID") return;
  await gatherPaidInvoiceEvidence(evidence, webhookInvoice.id as string);
}

async function gatherInvoicePaymentFailed(
  evidence: WebhookEvidence,
  webhookInvoice: Stripe.Invoice,
): Promise<void> {
  const subscriptionId = extractSubscriptionId(webhookInvoice);
  if (!subscriptionId) return;
  const agreement = await prisma.rentalAgreement.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true },
  });
  if (!agreement) return;
  const existing = await prisma.invoice.findUnique({
    where: { stripeInvoiceId: webhookInvoice.id },
    select: { id: true },
  });
  if (existing) return;
  await evidence.fetchInvoice(webhookInvoice.id as string);
}

/**
 * Gather, outside any transaction, the Stripe facts the event's handler will
 * need. The early local reads below only avoid pointless provider calls (for
 * example a replayed, already-recorded event); they decide nothing. The locked
 * transaction re-checks everything, and a missing item is fetched on demand.
 */
export async function gatherWebhookEvidence(event: Stripe.Event): Promise<WebhookEvidence> {
  const evidence = new WebhookEvidence();
  const processed = await prisma.webhookEvent.findUnique({
    where: { id: event.id },
    select: { id: true },
  });
  if (processed) return evidence;

  switch (event.type) {
    case "checkout.session.completed":
      await gatherCheckoutCompleted(evidence, event.data.object as Stripe.Checkout.Session);
      break;
    case "checkout.session.async_payment_succeeded":
      await gatherAsyncPaymentSucceeded(
        evidence,
        event.data.object as Stripe.Checkout.Session,
      );
      break;
    case "invoice.paid":
      await gatherInvoicePaid(evidence, event.data.object as Stripe.Invoice);
      break;
    case "invoice.payment_failed":
      await gatherInvoicePaymentFailed(evidence, event.data.object as Stripe.Invoice);
      break;
    default:
      break;
  }
  return evidence;
}
