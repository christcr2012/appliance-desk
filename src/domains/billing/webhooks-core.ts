import type Stripe from "stripe";
import type { InvoiceLineItemKind, Prisma } from "@prisma/client";
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
// Event dedupe and every local effect commit together under a Postgres
// transaction lock. Competing deliveries (including different event IDs
// for one payment or cumulative refund) cannot observe partial work.
// No handler charges Stripe; provider calls here only retrieve records.
// ---------------------------------------------------------------------------

async function alreadyProcessed(db: Prisma.TransactionClient, eventId: string): Promise<boolean> {
  return (await db.webhookEvent.findUnique({ where: { id: eventId } })) !== null;
}

async function markProcessed(db: Prisma.TransactionClient, event: Stripe.Event): Promise<void> {
  await db.webhookEvent.create({ data: { id: event.id, type: event.type } });
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
  db: Prisma.TransactionClient,
  stripeInvoice: Stripe.Invoice,
  agreementId: string,
  customerId: string,
  existingInvoiceId?: string,
): Promise<void> {
  const recorded = await db.invoice.findUnique({
    where: { stripeInvoiceId: stripeInvoice.id },
    select: { id: true, status: true, agreementId: true, customerId: true },
  });
  if (recorded && (recorded.agreementId !== agreementId || recorded.customerId !== customerId)) {
    throw new Error("Stripe invoice is already recorded for another agreement/customer");
  }
  if (recorded?.status === "PAID") return;
  const targetInvoiceId = existingInvoiceId ?? recorded?.id;

  const agreementLines = await db.rentalLine.findMany({
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

  {
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

    const invoice = targetInvoiceId
      ? await db.invoice.update({
          where: { id: targetInvoiceId },
          data: {
            ...invoiceFields,
            // The DELINQUENT row from the failed attempt was created with
            // no line items (invoice.payment_failed doesn't record them) —
            // add the real ones now that we know what was actually charged.
            lineItems: { createMany: { data: lineItemsData } },
          },
        })
      : await db.invoice.create({
          data: {
            customerId,
            agreementId,
            ...invoiceFields,
            stripeInvoiceId: stripeInvoice.id,
            lineItems: { createMany: { data: lineItemsData } },
          },
        });

    await db.payment.create({
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
      const existingDeposit = await db.deposit.findFirst({ where: { agreementId } });
      if (!existingDeposit) {
        await db.deposit.create({
          data: {
            agreementId,
            amountCents: depositLine.amountCents,
            refundable: true,
          },
        });
      }
    }

    const subscriptionId = extractSubscriptionId(stripeInvoice);

    await db.rentalAgreement.update({
      where: { id: agreementId },
      data: {
        ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
        ...(nextBillingDate ? { nextBillingDate } : {}),
      },
    });
  }
}

/**
 * Records what a signing Checkout Session actually collected (the
 * one-time deposit/damage-waiver, if any) as a PAID Invoice, and — since
 * every signing Checkout Session (mode "payment" or "setup") saves a
 * payment method via setup_future_usage — captures that payment method
 * onto Customer.stripeDefaultPaymentMethodId for the real recurring
 * Subscription to use later, at delivery (see
 * startRecurringBillingForAgreement in src/domains/billing/checkout.ts).
 * Amounts come from our own agreement record, not from re-parsing what
 * Stripe echoes back — depositCents/damageWaiverCents are already this
 * agreement's own frozen source of truth (docs/BUSINESS-RULES.md's
 * "price history is sacred").
 */
async function recordSigningPaymentMethod(
  db: Prisma.TransactionClient,
  customerId: string,
  paymentMethodId: string | null,
): Promise<void> {
  if (!paymentMethodId) return;
  await db.customer.update({
    where: { id: customerId },
    data: { stripeDefaultPaymentMethodId: paymentMethodId },
  });
}

async function recordOneTimeSigningCharge(
  db: Prisma.TransactionClient,
  agreementId: string,
  customerId: string,
  paymentIntentId: string,
): Promise<void> {
  const existingPayment = await db.payment.findFirst({
    where: { stripePaymentIntentId: paymentIntentId, status: "succeeded" },
    select: { invoice: { select: { agreementId: true, customerId: true } } },
  });
  if (existingPayment) {
    if (existingPayment.invoice.agreementId !== agreementId || existingPayment.invoice.customerId !== customerId) {
      throw new Error("Signing payment is already recorded for another agreement/customer");
    }
    return;
  }

  const agreement = await db.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: { depositCents: true, damageWaiverCents: true },
  });

  const lineItemsData: { kind: InvoiceLineItemKind; description: string; amountCents: number; rentalLineId: null }[] =
    [];
  if (agreement.depositCents > 0) {
    lineItemsData.push({
      kind: "DEPOSIT",
      description: "Security deposit",
      amountCents: agreement.depositCents,
      rentalLineId: null,
    });
  }
  if (agreement.damageWaiverCents > 0) {
    lineItemsData.push({
      kind: "DAMAGE_WAIVER",
      description: "Damage waiver",
      amountCents: agreement.damageWaiverCents,
      rentalLineId: null,
    });
  }
  if (lineItemsData.length === 0) return; // nothing was charged (a "setup"-mode session)

  const amountCents = lineItemsData.reduce((sum, item) => sum + item.amountCents, 0);
  const method = await resolvePaymentMethod(paymentIntentId);

  {
    const invoice = await db.invoice.create({
      data: {
        customerId,
        agreementId,
        status: "PAID",
        subtotalCents: amountCents,
        amountDueCents: amountCents,
        amountPaidCents: amountCents,
        lineItems: { createMany: { data: lineItemsData } },
      },
    });

    await db.payment.create({
      data: {
        invoiceId: invoice.id,
        amountCents,
        method,
        status: "succeeded",
        stripePaymentIntentId: paymentIntentId,
      },
    });

    const depositLine = lineItemsData.find((item) => item.kind === "DEPOSIT");
    if (depositLine) {
      const existingDeposit = await db.deposit.findFirst({ where: { agreementId } });
      if (!existingDeposit) {
        await db.deposit.create({
          data: { agreementId, amountCents: depositLine.amountCents, refundable: true },
        });
      }
    }
  }
}

/**
 * Records what an estimate's own deposit Checkout Session actually
 * collected (createDepositCheckoutSessionForEstimate, in
 * src/domains/billing/checkout.ts) as a PAID Invoice not tied to any
 * agreement yet (Invoice.agreementId is nullable for exactly this case —
 * no RentalAgreement exists until the estimate is later converted).
 * Guarded by Estimate.depositPaidAt already being set, same idempotency
 * spirit as the existing-Deposit checks elsewhere in this file — covers
 * both a genuine duplicate webhook delivery and this function somehow
 * being called twice directly.
 */
async function recordEstimateDepositPayment(
  db: Prisma.TransactionClient,
  estimateId: string,
  customerId: string,
  paymentIntentId: string,
): Promise<void> {
  const estimate = await db.estimate.findUniqueOrThrow({
    where: { id: estimateId },
    select: { depositCents: true, depositPaidAt: true },
  });
  if (estimate.depositPaidAt || estimate.depositCents <= 0) return;

  const method = await resolvePaymentMethod(paymentIntentId);

  {
    const invoice = await db.invoice.create({
      data: {
        customerId,
        agreementId: null,
        status: "PAID",
        subtotalCents: estimate.depositCents,
        amountDueCents: estimate.depositCents,
        amountPaidCents: estimate.depositCents,
        lineItems: {
          createMany: {
            data: [
              {
                kind: "DEPOSIT",
                description: "Deposit (collected at estimate approval)",
                amountCents: estimate.depositCents,
                rentalLineId: null,
              },
            ],
          },
        },
      },
    });

    await db.payment.create({
      data: {
        invoiceId: invoice.id,
        amountCents: estimate.depositCents,
        method,
        status: "succeeded",
        stripePaymentIntentId: paymentIntentId,
      },
    });

    await db.estimate.update({
      where: { id: estimateId },
      data: { depositPaidAt: new Date() },
    });
  }
}

/** The estimate-deposit counterpart to the "payment"-mode branch of
 * handleCheckoutSessionCompleted below — same shape (capture the payment
 * method, only record the charge once Stripe itself calls it "paid",
 * otherwise wait for the async event), just routed to an Estimate
 * instead of a RentalAgreement since no agreement exists yet at this
 * point (see createDepositCheckoutSessionForEstimate's own comment). */
async function handleEstimateDepositCheckoutCompleted(
  db: Prisma.TransactionClient,
  session: Stripe.Checkout.Session,
  estimateId: string,
): Promise<void> {
  const estimate = await db.estimate.findUniqueOrThrow({
    where: { id: estimateId },
    select: { customerId: true },
  });
  if (!estimate.customerId) return; // shouldn't happen — approveEstimate always sets this first

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntentId) return;

  const stripe = getStripeClient();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["payment_method"],
  });
  const methodId =
    typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id ?? null;
  await recordSigningPaymentMethod(db, estimate.customerId, methodId);

  // Same delayed-settlement (ACH) guard as the signing-charge branch
  // below — this event can fire before the money has actually moved.
  if (session.payment_status !== "paid") return;

  await recordEstimateDepositPayment(db, estimateId, estimate.customerId, paymentIntentId);
}

async function handleCheckoutSessionCompleted(db: Prisma.TransactionClient, session: Stripe.Checkout.Session): Promise<void> {
  const estimateId = session.metadata?.estimateId;
  if (estimateId) {
    await handleEstimateDepositCheckoutCompleted(db, session, estimateId);
    return;
  }

  const agreementId = session.metadata?.agreementId;
  if (!agreementId) return; // not one of our agreement or estimate checkouts

  // Legacy path: a Checkout Session created before billing-starts-at-
  // delivery (2026-09-28) shipped in "subscription" mode. Kept so an
  // in-flight session from right before that change still completes
  // correctly instead of being silently ignored.
  if (session.mode === "subscription") {
    if (!session.invoice) return;
    const stripe = getStripeClient();
    const invoiceId = typeof session.invoice === "string" ? session.invoice : session.invoice.id;
    const stripeInvoice = await stripe.invoices.retrieve(invoiceId, { expand: ["payments"] });
    if (stripeInvoice.status !== "paid") return;
    const agreement = await db.rentalAgreement.findUniqueOrThrow({
      where: { id: agreementId },
      select: { customerId: true },
    });
    await recordPaidInvoice(db, stripeInvoice, agreementId, agreement.customerId);
    return;
  }

  const agreement = await db.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: { customerId: true },
  });

  if (session.mode === "setup") {
    // Nothing charged — just collecting a payment method for later. A
    // "setup"-mode Checkout Session is only ever marked complete once
    // the underlying SetupIntent has actually succeeded (no delayed/
    // async variant the way a payment can have), so the payment method
    // is safe to capture immediately.
    const stripe = getStripeClient();
    const setupIntentId =
      typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
    if (!setupIntentId) return;
    const intent = await stripe.setupIntents.retrieve(setupIntentId);
    const methodId =
      typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id ?? null;
    await recordSigningPaymentMethod(db, agreement.customerId, methodId);
    return;
  }

  if (session.mode === "payment") {
    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!paymentIntentId) return;

    const stripe = getStripeClient();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["payment_method"],
    });
    const methodId =
      typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id ?? null;
    await recordSigningPaymentMethod(db, agreement.customerId, methodId);

    // Real-money bug fixed 2026-09-27, same principle applied here: for
    // a delayed-settlement method (ACH), this event can fire before the
    // money has actually moved — session.payment_status stays "unpaid"
    // until it clears. Only record the charge once Stripe itself already
    // considers it paid; otherwise wait for
    // checkout.session.async_payment_succeeded (or _failed) to say what
    // actually happened.
    if (session.payment_status !== "paid") return;

    await recordOneTimeSigningCharge(db, agreementId, agreement.customerId, paymentIntentId);
  }
}

/** The delayed-settlement counterpart to handleCheckoutSessionCompleted's
 * "payment" branch — fires once an ACH (or other async) debit for the
 * signing charge actually clears. */
async function handleCheckoutSessionAsyncPaymentSucceeded(
  db: Prisma.TransactionClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntentId) return;

  const estimateId = session.metadata?.estimateId;
  if (estimateId) {
    const estimate = await db.estimate.findUniqueOrThrow({
      where: { id: estimateId },
      select: { customerId: true },
    });
    if (!estimate.customerId) return;
    await recordEstimateDepositPayment(db, estimateId, estimate.customerId, paymentIntentId);
    return;
  }

  const agreementId = session.metadata?.agreementId;
  if (!agreementId) return;

  const agreement = await db.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: { customerId: true },
  });
  await recordOneTimeSigningCharge(db, agreementId, agreement.customerId, paymentIntentId);
}

/** The signing charge's bank debit failed after checkout.session.completed
 * already fired with it still pending — nothing was ever recorded as
 * paid (handleCheckoutSessionCompleted correctly held off), so there's
 * nothing to reverse; just an audit trail entry so it isn't invisible. */
async function handleCheckoutSessionAsyncPaymentFailed(
  db: Prisma.TransactionClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const estimateId = session.metadata?.estimateId;
  if (estimateId) {
    await db.auditLog.create({
      data: {
        userId: null,
        action: "estimate.deposit_payment_failed",
        entityType: "Estimate",
        entityId: estimateId,
        newValue: { reason: "The customer's bank payment for this estimate's deposit failed to clear." },
      },
    });
    return;
  }

  const agreementId = session.metadata?.agreementId;
  if (!agreementId) return;

  await db.auditLog.create({
    data: {
      userId: null,
      action: "billing.signing_payment_failed",
      entityType: "RentalAgreement",
      entityId: agreementId,
      newValue: { reason: "The customer's bank payment for signing (deposit/damage waiver) failed to clear." },
    },
  });
}

async function handleInvoicePaid(db: Prisma.TransactionClient, webhookInvoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = extractSubscriptionId(webhookInvoice);
  if (!subscriptionId) return; // a one-off invoice, not one of our subscriptions

  const agreement = await db.rentalAgreement.findUnique({
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
  const alreadyRecorded = await db.invoice.findUnique({
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

  await recordPaidInvoice(db, stripeInvoice, agreement.id, agreement.customerId, alreadyRecorded?.id);
}

async function handleInvoicePaymentFailed(db: Prisma.TransactionClient, webhookInvoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = extractSubscriptionId(webhookInvoice);
  if (!subscriptionId) return;

  const agreement = await db.rentalAgreement.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true, customerId: true },
  });
  if (!agreement) return;

  const existing = await db.invoice.findUnique({
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

  {
    const invoice = await db.invoice.create({
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

    await db.payment.create({
      data: {
        invoiceId: invoice.id,
        amountCents: stripeInvoice.amount_due,
        status: "failed",
        stripePaymentIntentId: paymentIntentId,
        failureReason: "Stripe reported this invoice's payment failed.",
      },
    });
  }
}

async function handleChargeRefunded(db: Prisma.TransactionClient, charge: Stripe.Charge): Promise<void> {
  // Newer Stripe API versions dropped Charge.invoice — the reliable way
  // back to one of our own Invoice rows is via the PaymentIntent id we
  // already stored on the original Payment record.
  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return; // a refund unrelated to any invoice of ours

  const payment = await db.payment.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { invoiceId: true },
  });
  if (!payment) return;
  const invoice = { id: payment.invoiceId };

  // amount_refunded is the running TOTAL refunded on this charge, and a
  // charge can be partially refunded more than once — only record the
  // delta beyond what we've already logged as a Refund here, so a second
  // partial refund on the same charge doesn't double-count the first.
  const alreadyRefundedCents = await db.refund.aggregate({
    where: { invoiceId: invoice.id },
    _sum: { amountCents: true },
  });
  const newAmountCents = charge.amount_refunded - (alreadyRefundedCents._sum.amountCents ?? 0);
  if (newAmountCents <= 0) return;

  await db.refund.create({
    data: {
      invoiceId: invoice.id,
      amountCents: newAmountCents,
      reason: "OTHER",
      notes: "Recorded automatically from a Stripe refund — see Stripe dashboard for who issued it and why.",
      stripeRefundId: typeof charge.refunds?.data[0]?.id === "string" ? charge.refunds.data[0].id : null,
    },
  });
}

async function handleSubscriptionDeleted(db: Prisma.TransactionClient, subscription: Stripe.Subscription): Promise<void> {
  const agreement = await db.rentalAgreement.findUnique({
    where: { stripeSubscriptionId: subscription.id },
    select: { id: true },
  });
  if (!agreement) return;

  // Deliberately does NOT change RentalAgreementStatus — whether the
  // rental itself is ending is Chris's own decision (endAgreement /
  // cancelAgreement in src/domains/agreements), not something billing
  // should decide on his behalf. This just leaves a clear record that
  // the recurring billing for this agreement has stopped.
  await db.auditLog.create({
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
async function processLockedEvent(db: Prisma.TransactionClient, event: Stripe.Event): Promise<void> {
  if (await alreadyProcessed(db, event.id)) return;

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(db, event.data.object as Stripe.Checkout.Session);
      break;
    case "checkout.session.async_payment_succeeded":
      await handleCheckoutSessionAsyncPaymentSucceeded(db, event.data.object as Stripe.Checkout.Session);
      break;
    case "checkout.session.async_payment_failed":
      await handleCheckoutSessionAsyncPaymentFailed(db, event.data.object as Stripe.Checkout.Session);
      break;
    case "invoice.paid":
      await handleInvoicePaid(db, event.data.object as Stripe.Invoice);
      break;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(db, event.data.object as Stripe.Invoice);
      break;
    case "charge.refunded":
      await handleChargeRefunded(db, event.data.object as Stripe.Charge);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(db, event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }

  await markProcessed(db, event);
}

/** A single-business lock also serializes distinct cumulative refund events.
 * A handler failure, timeout, or failed event receipt rolls back every local
 * effect and releases the lock; route.ts returns 500 so Stripe can retry.
 * The transaction expires after 30 seconds; provider request timeouts remain
 * separate. No success is acknowledged before commit. This favors correctness
 * over throughput; provider latency/capacity remain release checks.
 */
export async function processStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  await prisma.$transaction(async (db) => {
    // Dedicated two-int namespace; transaction-scoped and shared across instances.
    await db.$queryRaw`SELECT pg_advisory_xact_lock(174831, 1)::text`;
    await processLockedEvent(db, event);
  }, { maxWait: 10_000, timeout: 30_000 });
}
