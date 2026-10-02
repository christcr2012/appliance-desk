import type Stripe from "stripe";
import type { InvoiceLineItemKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import {
  attachProviderIdsToReceiptPayments,
  createReceiptWithAllocations,
  recordFailedPaymentAttempt,
} from "./ledger";

async function alreadyProcessed(db: Prisma.TransactionClient, eventId: string): Promise<boolean> {
  return (await db.webhookEvent.findUnique({ where: { id: eventId } })) !== null;
}

async function markProcessed(db: Prisma.TransactionClient, event: Stripe.Event): Promise<void> {
  await db.webhookEvent.create({ data: { id: event.id, type: event.type } });
}

function inferLineItemKind(description: string | null): InvoiceLineItemKind {
  if (description === "Security deposit") return "DEPOSIT";
  if (description === "Damage waiver") return "DAMAGE_WAIVER";
  return "RENTAL";
}

function matchRentalLineId(
  description: string | null,
  lines: { id: string; label: string }[],
): string | null {
  if (!description) return null;
  return lines.find((line) => line.label === description)?.id ?? null;
}

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

type PaymentDetails = {
  method: string | null;
  stripeChargeId: string | null;
  receivedOn: Date;
};

/**
 * Resolve the provider facts for one successful PaymentIntent. Receipt dates
 * use the Stripe charge's creation instant when available, not our webhook
 * processing time. That gives reports the provider-effective date basis.
 */
async function resolvePaymentDetails(
  paymentIntentId: string | null,
  fallbackReceivedOn = new Date(),
): Promise<PaymentDetails> {
  if (!paymentIntentId) {
    return { method: null, stripeChargeId: null, receivedOn: fallbackReceivedOn };
  }
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
  };
}

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
  const fallbackPaidAt = stripeInvoice.status_transitions?.paid_at
    ? new Date(stripeInvoice.status_transitions.paid_at * 1000)
    : new Date();
  const paymentDetails = await resolvePaymentDetails(paymentIntentId, fallbackPaidAt);
  const nextBillingDate = stripeInvoice.period_end
    ? new Date(stripeInvoice.period_end * 1000)
    : null;

  const hasCashReceipt = stripeInvoice.amount_paid > 0;
  const invoiceFields = {
    status: hasCashReceipt ? ("OPEN" as const) : ("PAID" as const),
    billingPeriodStart: stripeInvoice.period_start
      ? new Date(stripeInvoice.period_start * 1000)
      : null,
    billingPeriodEnd: stripeInvoice.period_end
      ? new Date(stripeInvoice.period_end * 1000)
      : null,
    subtotalCents,
    taxCents,
    amountDueCents: stripeInvoice.amount_due,
    amountPaidCents: 0,
    dueDate: stripeInvoice.due_date ? new Date(stripeInvoice.due_date * 1000) : null,
  };

  const invoice = targetInvoiceId
    ? await db.invoice.update({
        where: { id: targetInvoiceId },
        data: {
          ...invoiceFields,
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

  if (hasCashReceipt) {
    const { receiptId } = await createReceiptWithAllocations(db, {
      customerId,
      source: "STRIPE",
      amountCents: stripeInvoice.amount_paid,
      method: paymentDetails.method ?? "other",
      receivedOn: paymentDetails.receivedOn,
      stripeChargeId: paymentDetails.stripeChargeId ?? undefined,
      allocations: [{ invoiceId: invoice.id, amountCents: stripeInvoice.amount_paid }],
    });
    if (paymentIntentId) {
      await attachProviderIdsToReceiptPayments(db, {
        receiptId,
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId: paymentDetails.stripeChargeId,
      });
    }
  }

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
    if (
      existingPayment.invoice.agreementId !== agreementId ||
      existingPayment.invoice.customerId !== customerId
    ) {
      throw new Error("Signing payment is already recorded for another agreement/customer");
    }
    return;
  }

  const agreement = await db.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: { depositCents: true, damageWaiverCents: true },
  });
  const lineItemsData: {
    kind: InvoiceLineItemKind;
    description: string;
    amountCents: number;
    rentalLineId: null;
  }[] = [];
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
  if (lineItemsData.length === 0) return;

  const amountCents = lineItemsData.reduce((sum, item) => sum + item.amountCents, 0);
  const paymentDetails = await resolvePaymentDetails(paymentIntentId);
  const invoice = await db.invoice.create({
    data: {
      customerId,
      agreementId,
      status: "OPEN",
      subtotalCents: amountCents,
      amountDueCents: amountCents,
      amountPaidCents: 0,
      lineItems: { createMany: { data: lineItemsData } },
    },
  });

  const { receiptId } = await createReceiptWithAllocations(db, {
    customerId,
    source: "STRIPE",
    amountCents,
    method: paymentDetails.method ?? "other",
    receivedOn: paymentDetails.receivedOn,
    stripeChargeId: paymentDetails.stripeChargeId ?? undefined,
    allocations: [{ invoiceId: invoice.id, amountCents }],
  });
  await attachProviderIdsToReceiptPayments(db, {
    receiptId,
    stripePaymentIntentId: paymentIntentId,
    stripeChargeId: paymentDetails.stripeChargeId,
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

  const paymentDetails = await resolvePaymentDetails(paymentIntentId);
  const invoice = await db.invoice.create({
    data: {
      customerId,
      agreementId: null,
      status: "OPEN",
      subtotalCents: estimate.depositCents,
      amountDueCents: estimate.depositCents,
      amountPaidCents: 0,
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

  const { receiptId } = await createReceiptWithAllocations(db, {
    customerId,
    source: "STRIPE",
    amountCents: estimate.depositCents,
    method: paymentDetails.method ?? "other",
    receivedOn: paymentDetails.receivedOn,
    stripeChargeId: paymentDetails.stripeChargeId ?? undefined,
    allocations: [{ invoiceId: invoice.id, amountCents: estimate.depositCents }],
  });
  await attachProviderIdsToReceiptPayments(db, {
    receiptId,
    stripePaymentIntentId: paymentIntentId,
    stripeChargeId: paymentDetails.stripeChargeId,
  });

  await db.estimate.update({
    where: { id: estimateId },
    data: { depositPaidAt: new Date() },
  });
}

async function handleEstimateDepositCheckoutCompleted(
  db: Prisma.TransactionClient,
  session: Stripe.Checkout.Session,
  estimateId: string,
): Promise<void> {
  const estimate = await db.estimate.findUniqueOrThrow({
    where: { id: estimateId },
    select: { customerId: true },
  });
  if (!estimate.customerId) return;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!paymentIntentId) return;

  const stripe = getStripeClient();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["payment_method"],
  });
  const methodId =
    typeof intent.payment_method === "string"
      ? intent.payment_method
      : intent.payment_method?.id ?? null;
  await recordSigningPaymentMethod(db, estimate.customerId, methodId);
  if (session.payment_status !== "paid") return;
  await recordEstimateDepositPayment(db, estimateId, estimate.customerId, paymentIntentId);
}

async function handleCheckoutSessionCompleted(
  db: Prisma.TransactionClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const estimateId = session.metadata?.estimateId;
  if (estimateId) {
    await handleEstimateDepositCheckoutCompleted(db, session, estimateId);
    return;
  }

  const agreementId = session.metadata?.agreementId;
  if (!agreementId) return;

  if (session.mode === "subscription") {
    if (!session.invoice) return;
    const stripe = getStripeClient();
    const invoiceId =
      typeof session.invoice === "string" ? session.invoice : session.invoice.id;
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
    const stripe = getStripeClient();
    const setupIntentId =
      typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
    if (!setupIntentId) return;
    const intent = await stripe.setupIntents.retrieve(setupIntentId);
    const methodId =
      typeof intent.payment_method === "string"
        ? intent.payment_method
        : intent.payment_method?.id ?? null;
    await recordSigningPaymentMethod(db, agreement.customerId, methodId);
    return;
  }

  if (session.mode === "payment") {
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentIntentId) return;

    const stripe = getStripeClient();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["payment_method"],
    });
    const methodId =
      typeof intent.payment_method === "string"
        ? intent.payment_method
        : intent.payment_method?.id ?? null;
    await recordSigningPaymentMethod(db, agreement.customerId, methodId);
    if (session.payment_status !== "paid") return;
    await recordOneTimeSigningCharge(db, agreementId, agreement.customerId, paymentIntentId);
  }
}

async function handleCheckoutSessionAsyncPaymentSucceeded(
  db: Prisma.TransactionClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
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
        newValue: {
          reason: "The customer's bank payment for this estimate's deposit failed to clear.",
        },
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
      newValue: {
        reason: "The customer's bank payment for signing (deposit/damage waiver) failed to clear.",
      },
    },
  });
}

async function handleInvoicePaid(
  db: Prisma.TransactionClient,
  webhookInvoice: Stripe.Invoice,
): Promise<void> {
  const subscriptionId = extractSubscriptionId(webhookInvoice);
  if (!subscriptionId) return;

  const agreement = await db.rentalAgreement.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true, customerId: true },
  });
  if (!agreement) return;

  const alreadyRecorded = await db.invoice.findUnique({
    where: { stripeInvoiceId: webhookInvoice.id },
    select: { id: true, status: true },
  });
  if (alreadyRecorded?.status === "PAID") return;

  const stripe = getStripeClient();
  const stripeInvoice = await stripe.invoices.retrieve(webhookInvoice.id as string, {
    expand: ["payments"],
  });
  await recordPaidInvoice(
    db,
    stripeInvoice,
    agreement.id,
    agreement.customerId,
    alreadyRecorded?.id,
  );
}

async function handleInvoicePaymentFailed(
  db: Prisma.TransactionClient,
  webhookInvoice: Stripe.Invoice,
): Promise<void> {
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
  if (existing) return;

  const stripe = getStripeClient();
  const stripeInvoice = await stripe.invoices.retrieve(webhookInvoice.id as string, {
    expand: ["payments"],
  });
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

  await recordFailedPaymentAttempt(db, {
    invoiceId: invoice.id,
    amountCents: stripeInvoice.amount_due,
    stripePaymentIntentId: extractPaymentIntentId(stripeInvoice),
    failureReason: "Stripe reported this invoice's payment failed.",
  });
}

async function handleChargeRefunded(
  db: Prisma.TransactionClient,
  charge: Stripe.Charge,
): Promise<void> {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) return;

  const payment = await db.payment.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { invoiceId: true },
  });
  if (!payment) return;
  const alreadyRefundedCents = await db.refund.aggregate({
    where: { invoiceId: payment.invoiceId },
    _sum: { amountCents: true },
  });
  const newAmountCents =
    charge.amount_refunded - (alreadyRefundedCents._sum.amountCents ?? 0);
  if (newAmountCents <= 0) return;

  await db.refund.create({
    data: {
      invoiceId: payment.invoiceId,
      amountCents: newAmountCents,
      reason: "OTHER",
      notes:
        "Recorded automatically from a Stripe refund — see Stripe dashboard for who issued it and why.",
      stripeRefundId:
        typeof charge.refunds?.data[0]?.id === "string" ? charge.refunds.data[0].id : null,
    },
  });
}

async function handleSubscriptionDeleted(
  db: Prisma.TransactionClient,
  subscription: Stripe.Subscription,
): Promise<void> {
  const agreement = await db.rentalAgreement.findUnique({
    where: { stripeSubscriptionId: subscription.id },
    select: { id: true },
  });
  if (!agreement) return;

  await db.auditLog.create({
    data: {
      userId: null,
      action: "billing.subscription_ended",
      entityType: "RentalAgreement",
      entityId: agreement.id,
      newValue: {
        stripeSubscriptionId: subscription.id,
        reason: subscription.cancellation_details?.reason ?? null,
      },
    },
  });
}

async function processLockedEvent(
  db: Prisma.TransactionClient,
  event: Stripe.Event,
): Promise<void> {
  if (await alreadyProcessed(db, event.id)) return;

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(db, event.data.object as Stripe.Checkout.Session);
      break;
    case "checkout.session.async_payment_succeeded":
      await handleCheckoutSessionAsyncPaymentSucceeded(
        db,
        event.data.object as Stripe.Checkout.Session,
      );
      break;
    case "checkout.session.async_payment_failed":
      await handleCheckoutSessionAsyncPaymentFailed(
        db,
        event.data.object as Stripe.Checkout.Session,
      );
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

/**
 * One transaction-scoped advisory lock serializes Stripe event application.
 * Any handler failure rolls back both the business mutation and WebhookEvent,
 * so route.ts can return 500 and Stripe can safely retry.
 */
export async function processStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  await prisma.$transaction(
    async (db) => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(174831, 1)::text`;
      await processLockedEvent(db, event);
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}
