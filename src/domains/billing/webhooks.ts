import type Stripe from "stripe";
import type { InvoiceLineItemKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";

// ---------------------------------------------------------------------------
// Phase 6B — reacting to what Stripe tells us actually happened. Stripe
// never trusts our own server to know when money moved; it tells us via
// these webhook events, which is why nothing in checkout.ts marks
// anything "paid" — only this file does, and only once Stripe confirms
// it. See src/app/api/webhooks/stripe/route.ts for signature
// verification and docs/BUSINESS-RULES.md's billing rules for the
// policy this reflects.
//
// Idempotency: webhook delivery is at-least-once (Stripe retries on
// timeout, and the same event can genuinely be delivered twice). Every
// event is recorded in WebhookEvent, keyed by Stripe's own event id,
// before it's acted on — see recordWebhookEventOnce below, which is the
// single choke point every handler goes through.
// ---------------------------------------------------------------------------

/** True if this event id has already been fully processed. Checked
 * *before* doing any work, so a genuine duplicate delivery is a cheap
 * no-op read rather than repeating a webhook's side effects. */
async function alreadyProcessed(eventId: string): Promise<boolean> {
  const existing = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  return existing !== null;
}

/** Marks this event as done — called only *after* its handler has
 * already succeeded (see processStripeWebhookEvent below), never before.
 * Recording it up front instead would mean a handler that crashes
 * partway through gets marked "done" anyway, and Stripe's automatic
 * retry of that same event (which is the normal way a transient failure
 * gets fixed) would then be silently skipped instead of actually
 * retried. The small tradeoff: two deliveries of the same event arriving
 * within milliseconds of each other could both start processing before
 * either finishes — accepted here since each handler's own writes (a
 * unique `stripeInvoiceId`, an existing-Deposit check, etc.) still catch
 * the common cases; Stripe's real-world duplicate deliveries are
 * overwhelmingly minutes-later retries, not simultaneous ones. */
async function markProcessed(event: Stripe.Event): Promise<void> {
  await prisma.webhookEvent.create({ data: { id: event.id, type: event.type } });
}

/** Maps a Stripe invoice line's description back to which kind of charge
 * it was — matched against the exact description strings checkout.ts
 * sets, rather than requiring an extra expand()'d API call just to read
 * product metadata back. "Everything else" is treated as RENTAL, which
 * is correct for every rental line (their descriptions are Chris's own
 * per-line labels, which can't collide with the two fixed ones below). */
function inferLineItemKind(description: string | null): InvoiceLineItemKind {
  if (description === "Security deposit") return "DEPOSIT";
  if (description === "Damage waiver") return "DAMAGE_WAIVER";
  return "RENTAL";
}

/** Best-effort: if a rental line's label still matches one of this
 * agreement's current RentalLine rows, record which one this invoice
 * line came from (InvoiceLineItem.rentalLineId) — purely for
 * traceability, per the schema's own comment on that field; never used
 * to recompute an amount, so it's safe to just leave null when it can't
 * be matched (e.g. a line was removed from the agreement after the fact). */
function matchRentalLineId(
  description: string | null,
  lines: { id: string; label: string }[],
): string | null {
  if (!description) return null;
  return lines.find((line) => line.label === description)?.id ?? null;
}

/** Stripe's newer API versions moved the subscription/payment-intent
 * references that used to sit directly on Invoice into nested objects
 * (`parent.subscription_details.subscription`, `payments.data[].payment`),
 * and moved per-line tax out of a single `tax` field into a `total_taxes`
 * array. These three helpers are the one place that unwraps those shapes,
 * so every handler below reads them the same, correct way. */
function extractSubscriptionId(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
}

function extractPaymentIntentId(invoice: Stripe.Invoice): string | null {
  const payment = invoice.payments?.data[0]?.payment;
  const paymentIntent = payment?.payment_intent;
  if (!paymentIntent) return null;
  return typeof paymentIntent === "string" ? paymentIntent : paymentIntent.id;
}

function extractTaxCents(invoice: Stripe.Invoice): number {
  return (invoice.total_taxes ?? []).reduce((sum, entry) => sum + entry.amount, 0);
}

/** "card" or "ach" for our own records (docs/BUSINESS-RULES.md's
 * "both cards and ACH" rule) — found by asking Stripe what payment
 * method actually settled this invoice's PaymentIntent. Returns null if
 * there's no PaymentIntent to check (e.g. a $0 invoice) or Stripe
 * couldn't tell us, which is an honest "unknown" rather than a guess. */
async function resolvePaymentMethod(paymentIntentId: string | null): Promise<string | null> {
  if (!paymentIntentId) return null;
  const stripe = getStripeClient();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["payment_method"],
  });
  const method = intent.payment_method;
  if (!method || typeof method === "string") return null;
  if (method.type === "us_bank_account") return "ach";
  if (method.type === "card") return "card";
  return method.type;
}

/** Shared by both the very first invoice (from checkout.session.completed)
 * and every recurring monthly one (from invoice.paid) — the same mapping
 * applies either way, since Stripe models both as an Invoice object.
 * `status` is PAID here specifically; invoice.payment_failed uses its own
 * separate, simpler path below rather than reusing this.
 *
 * `existingInvoiceId`: pass this when a *failed* attempt at this exact
 * Stripe invoice was already recorded (a DELINQUENT row created by
 * handleInvoicePaymentFailed) and it has now actually succeeded on a
 * retry — that row is updated to PAID (and given its real line items and
 * a new succeeded Payment) instead of being skipped or duplicated. Real-
 * money bug fixed 2026-09-27: this case used to be silently skipped
 * because an Invoice already existed for that stripeInvoiceId, leaving a
 * customer who successfully paid after an earlier failure still showing
 * as unpaid — see docs/DECISIONS.md. */
async function recordPaidInvoice(
  stripeInvoice: Stripe.Invoice,
  agreementId: string,
  customerId: string,
  existingInvoiceId?: string,
): Promise<void> {
  const agreementLines = await prisma.rentalLine.findMany({
    where: { agreementId },
    select: { id: true, label: true },
  });

  const lineItemsData = stripeInvoice.lines.data.map((line) => ({
    kind: inferLineItemKind(line.description),
    description: line.description ?? "Charge",
    amountCents: line.amount,
    rentalLineId: matchRentalLineId(line.description, agreementLines),
  }));

  const taxCents = extractTaxCents(stripeInvoice);
  if (taxCents > 0) {
    lineItemsData.push({
      kind: "TAX" as InvoiceLineItemKind,
      description: "Sales tax",
      amountCents: taxCents,
      rentalLineId: null,
    });
  }

  const subtotalCents = lineItemsData
    .filter((item) => item.kind !== "TAX")
    .reduce((sum, item) => sum + item.amountCents, 0);

  const paymentIntentId = extractPaymentIntentId(stripeInvoice);
  const method = await resolvePaymentMethod(paymentIntentId);

  const nextBillingDate = stripeInvoice.period_end
    ? new Date(stripeInvoice.period_end * 1000)
    : null;

  await prisma.$transaction(async (tx) => {
    const invoiceFields = {
      status: "PAID" as const,
      billingPeriodStart: stripeInvoice.period_start
        ? new Date(stripeInvoice.period_start * 1000)
        : null,
      billingPeriodEnd: stripeInvoice.period_end
        ? new Date(stripeInvoice.period_end * 1000)
        : null,
      subtotalCents,
      taxCents,
      amountDueCents: stripeInvoice.amount_due,
      amountPaidCents: stripeInvoice.amount_paid,
      dueDate: stripeInvoice.due_date ? new Date(stripeInvoice.due_date * 1000) : null,
    };

    const invoice = existingInvoiceId
      ? await tx.invoice.update({
          where: { id: existingInvoiceId },
          data: {
            ...invoiceFields,
            // The DELINQUENT row from the failed attempt was created with
            // no line items (invoice.payment_failed doesn't record them) —
            // add the real ones now that we know what was actually charged.
            lineItems: { createMany: { data: lineItemsData } },
          },
        })
      : await tx.invoice.create({
          data: {
            customerId,
            agreementId,
            ...invoiceFields,
            stripeInvoiceId: stripeInvoice.id,
            lineItems: { createMany: { data: lineItemsData } },
          },
        });

    await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        amountCents: stripeInvoice.amount_paid,
        method,
        status: "succeeded",
        stripePaymentIntentId: paymentIntentId,
      },
    });

    // The security deposit is only ever collected once, on that first
    // invoice — guard against creating a second Deposit row even if this
    // ends up running more than once for the same agreement (the
    // WebhookEvent check already prevents that for a single event, this
    // is a second, cheap safety net against re-running this function
    // directly).
    const depositLine = lineItemsData.find((item) => item.kind === "DEPOSIT");
    if (depositLine) {
      const existingDeposit = await tx.deposit.findFirst({ where: { agreementId } });
      if (!existingDeposit) {
        await tx.deposit.create({
          data: {
            agreementId,
            amountCents: depositLine.amountCents,
            refundable: true,
          },
        });
      }
    }

    const subscriptionId = extractSubscriptionId(stripeInvoice);

    await tx.rentalAgreement.update({
      where: { id: agreementId },
      data: {
        ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
        ...(nextBillingDate ? { nextBillingDate } : {}),
      },
    });
  });
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const agreementId = session.metadata?.agreementId;
  if (!agreementId) return; // not one of our agreement checkouts
  if (session.mode !== "subscription" || !session.invoice) return;

  const stripe = getStripeClient();
  const invoiceId =
    typeof session.invoice === "string" ? session.invoice : session.invoice.id;
  const stripeInvoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ["payments"],
  });

  // Real-money bug fixed 2026-09-27: this event fires as soon as the
  // customer finishes Stripe's Checkout flow, which for a delayed-
  // settlement payment method (ACH bank transfer, one of the two methods
  // docs/BUSINESS-RULES.md offers) is BEFORE the money has actually moved
  // — the underlying invoice can still be "open" for days while the bank
  // debit clears, and can still fail. Recording it as PAID here
  // regardless would show a pending (or later-failed) bank payment as
  // paid immediately. Only record it here once Stripe itself already
  // considers the invoice paid; otherwise wait for the invoice.paid (or
  // invoice.payment_failed) webhook to say what actually happened — see
  // docs/DECISIONS.md.
  if (stripeInvoice.status !== "paid") return;

  const agreement = await prisma.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: { customerId: true },
  });

  await recordPaidInvoice(stripeInvoice, agreementId, agreement.customerId);
}

async function handleInvoicePaid(webhookInvoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = extractSubscriptionId(webhookInvoice);
  if (!subscriptionId) return; // a one-off invoice, not one of our subscriptions

  const agreement = await prisma.rentalAgreement.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true, customerId: true },
  });
  if (!agreement) return; // not an agreement we know about

  // The very first invoice on a subscription, when paid immediately with
  // an instant method (card), is already handled by
  // checkout.session.completed above — Stripe fires invoice.paid for that
  // same invoice too, so a truly-already-PAID invoice is skipped here to
  // avoid recording it twice. Every later month, checkout.session.completed
  // never fires again, so invoice.paid is the only signal.
  //
  // But an existing invoice that is NOT yet paid — created DELINQUENT by
  // handleInvoicePaymentFailed after an earlier failed attempt, or never
  // recorded as paid by checkout.session.completed because it was still
  // pending on a delayed-settlement method (ACH) — means this invoice.paid
  // is the first time we've learned it actually succeeded. Real-money bug
  // fixed 2026-09-27: this case used to be skipped outright just because
  // *an* Invoice row existed, leaving a customer who paid (possibly after
  // an earlier failure) still showing as unpaid or delinquent forever —
  // see docs/DECISIONS.md.
  const alreadyRecorded = await prisma.invoice.findUnique({
    where: { stripeInvoiceId: webhookInvoice.id },
    select: { id: true, status: true },
  });
  if (alreadyRecorded?.status === "PAID") return;

  // The webhook payload itself doesn't carry the expanded `payments` data
  // extractPaymentIntentId needs, so re-fetch the invoice fresh rather than
  // trusting whatever shape Stripe happened to send in the event body.
  const stripe = getStripeClient();
  const stripeInvoice = await stripe.invoices.retrieve(webhookInvoice.id as string, {
    expand: ["payments"],
  });

  await recordPaidInvoice(stripeInvoice, agreement.id, agreement.customerId, alreadyRecorded?.id);
}

async function handleInvoicePaymentFailed(webhookInvoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = extractSubscriptionId(webhookInvoice);
  if (!subscriptionId) return;

  const agreement = await prisma.rentalAgreement.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true, customerId: true },
  });
  if (!agreement) return;

  const existing = await prisma.invoice.findUnique({
    where: { stripeInvoiceId: webhookInvoice.id },
    select: { id: true },
  });
  if (existing) {
    // A retry of an invoice we already recorded as failed once —
    // nothing new to do.
    return;
  }

  const stripe = getStripeClient();
  const stripeInvoice = await stripe.invoices.retrieve(webhookInvoice.id as string, {
    expand: ["payments"],
  });

  await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        customerId: agreement.customerId,
        agreementId: agreement.id,
        status: "DELINQUENT",
        billingPeriodStart: stripeInvoice.period_start
          ? new Date(stripeInvoice.period_start * 1000)
          : null,
        billingPeriodEnd: stripeInvoice.period_end
          ? new Date(stripeInvoice.period_end * 1000)
          : null,
        subtotalCents: stripeInvoice.subtotal,
        taxCents: extractTaxCents(stripeInvoice),
        amountDueCents: stripeInvoice.amount_due,
        amountPaidCents: stripeInvoice.amount_paid,
        dueDate: stripeInvoice.due_date ? new Date(stripeInvoice.due_date * 1000) : null,
        stripeInvoiceId: stripeInvoice.id,
      },
    });

    const paymentIntentId = extractPaymentIntentId(stripeInvoice);

    await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        amountCents: stripeInvoice.amount_due,
        status: "failed",
        stripePaymentIntentId: paymentIntentId,
        failureReason: "Stripe reported this invoice's payment failed.",
      },
    });
  });
}

async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  // Newer Stripe API versions dropped Charge.invoice — the reliable way
  // back to one of our own Invoice rows is via the PaymentIntent id we
  // already stored on the original Payment record.
  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return; // a refund unrelated to any invoice of ours

  const payment = await prisma.payment.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { invoiceId: true },
  });
  if (!payment) return;
  const invoice = { id: payment.invoiceId };

  // amount_refunded is the running TOTAL refunded on this charge, and a
  // charge can be partially refunded more than once — only record the
  // delta beyond what we've already logged as a Refund here, so a second
  // partial refund on the same charge doesn't double-count the first.
  const alreadyRefundedCents = await prisma.refund.aggregate({
    where: { invoiceId: invoice.id },
    _sum: { amountCents: true },
  });
  const newAmountCents = charge.amount_refunded - (alreadyRefundedCents._sum.amountCents ?? 0);
  if (newAmountCents <= 0) return;

  await prisma.refund.create({
    data: {
      invoiceId: invoice.id,
      amountCents: newAmountCents,
      reason: "OTHER",
      notes: "Recorded automatically from a Stripe refund — see Stripe dashboard for who issued it and why.",
      stripeRefundId: typeof charge.refunds?.data[0]?.id === "string" ? charge.refunds.data[0].id : null,
    },
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const agreement = await prisma.rentalAgreement.findUnique({
    where: { stripeSubscriptionId: subscription.id },
    select: { id: true },
  });
  if (!agreement) return;

  // Deliberately does NOT change RentalAgreementStatus — whether the
  // rental itself is ending is Chris's own decision (endAgreement /
  // cancelAgreement in src/domains/agreements), not something billing
  // should decide on his behalf. This just leaves a clear record that
  // the recurring billing for this agreement has stopped.
  await prisma.auditLog.create({
    data: {
      userId: null,
      action: "billing.subscription_ended",
      entityType: "RentalAgreement",
      entityId: agreement.id,
      newValue: { stripeSubscriptionId: subscription.id, reason: subscription.cancellation_details?.reason ?? null },
    },
  });
}

/** The single entry point route.ts calls after verifying a webhook's
 * signature. Handles idempotency itself, then dispatches by event type —
 * an event type we don't otherwise care about is simply recorded (for the
 * dedupe table) and ignored, not an error. */
export async function processStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  if (await alreadyProcessed(event.id)) return;

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "invoice.paid":
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
      break;
    case "charge.refunded":
      await handleChargeRefunded(event.data.object as Stripe.Charge);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }

  await markProcessed(event);
}
