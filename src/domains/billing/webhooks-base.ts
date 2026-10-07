import type Stripe from "stripe";
import type { InvoiceLineItemKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { rewardReferralOnFirstPaidInvoice } from "@/domains/referrals";
import {
  attachProviderIdsToReceiptPayments,
  createReceiptWithAllocations,
  lockCustomerLedger,
  holdReceiptForClosedInvoice,
  recordFailedPaymentAttempt,
} from "./ledger";
import {
  extractSubscriptionId,
  gatherWebhookEvidence,
  idOf,
  MissingWebhookEvidenceError,
  type WebhookEvidence,
} from "./webhook-evidence";
import { appliedBalanceCreditCents, creditLinesForAppliedBalance } from "./applied-credit-lines";
import { LATE_DELIVERY_CREDIT_SOURCE } from "./pickup-billing";
import {
  recordStripeInvoiceTaxEvidenceInTx,
  type MirroredStripeChargeLine,
} from "@/domains/tax/stripe-invoice-mirror";
import {
  HELD_CONFLICT_STATUS,
  HELD_PAYMENT_STATUS,
  HELD_REFUNDED_STATUS,
  HELD_TO_CREDIT_STATUS,
  SUCCESSFUL_PAYMENT_STATUSES,
} from "./payment-status";

async function alreadyProcessed(db: Prisma.TransactionClient, eventId: string): Promise<boolean> {
  return (await db.webhookEvent.findUnique({ where: { id: eventId } })) !== null;
}

async function markProcessed(db: Prisma.TransactionClient, event: Stripe.Event): Promise<void> {
  await db.webhookEvent.create({ data: { id: event.id, type: event.type } });
}

function inferLineItemKind(description: string | null): InvoiceLineItemKind {
  if (description === "Security deposit") return "DEPOSIT";
  if (description === "Damage waiver") return "DAMAGE_WAIVER";
  if (description?.startsWith("Late return – ")) return "LATE_RETURN";
  if (description?.startsWith("Credit – ")) return "CREDIT";
  return "RENTAL";
}

function matchRentalLineId(
  description: string | null,
  lines: { id: string; label: string }[],
): string | null {
  if (!description) return null;
  return lines.find((line) => line.label === description)?.id ?? null;
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

/**
 * Stripe took real money for an invoice the owner has already written off (or
 * voided). The money is recorded as received, but it is not applied to the
 * closed invoice, the write-off is not silently undone, and no spendable
 * account credit is created: the owner decides what happens next (IN-23). It is
 * held as a receipt plus a `held` payment row (see `holdReceiptForClosedInvoice`),
 * which also lets a later Stripe refund of that charge find it. An audit entry
 * asks the owner to review it.
 */
async function holdPaymentForClosedInvoice(
  db: Prisma.TransactionClient,
  evidence: WebhookEvidence,
  stripeInvoice: Stripe.Invoice,
  customerId: string,
  invoiceId: string,
  status: string,
): Promise<void> {
  const cashEvents = evidence.cashEvents(stripeInvoice.id as string);
  for (const cashEvent of cashEvents) {
    await holdReceiptForClosedInvoice(db, {
      customerId,
      invoiceId,
      amountCents: cashEvent.amountCents,
      method: cashEvent.method,
      receivedOn: cashEvent.receivedOn,
      stripeChargeId: cashEvent.stripeChargeId,
      stripePaymentIntentId: cashEvent.paymentIntentId,
    });
  }
  await db.auditLog.create({
    data: {
      userId: null,
      action: "billing.payment_on_closed_invoice",
      entityType: "Invoice",
      entityId: invoiceId,
      newValue: {
        invoiceStatus: status,
        stripeInvoiceId: stripeInvoice.id,
        receivedCents: cashEvents.reduce((sum, e) => sum + e.amountCents, 0),
        handling:
          "Held for the owner. The invoice was not reopened and no account credit was created. Review and decide.",
      },
    },
  });
}

async function mirrorStripeInvoiceLines(
  db: Prisma.TransactionClient,
  stripeInvoice: Stripe.Invoice,
  agreementId: string,
  customerId: string,
  invoiceId: string,
): Promise<{ subtotalCents: number; depositLineAmountCents: number | null }> {
  const existingLines = await db.invoiceLineItem.findMany({
    where: { invoiceId },
    select: { kind: true, amountCents: true },
  });
  if (existingLines.length > 0) {
    return {
      subtotalCents: existingLines
        .filter((item) => item.kind !== "TAX")
        .reduce((sum, item) => sum + item.amountCents, 0),
      depositLineAmountCents:
        existingLines.find((item) => item.kind === "DEPOSIT")?.amountCents ?? null,
    };
  }

  const agreementLines = await db.rentalLine.findMany({
    where: { agreementId },
    select: { id: true, label: true },
  });
  const providerLines = stripeInvoice.lines.data.map((line) => ({
    stripeLine: line,
    kind: inferLineItemKind(line.description),
    description: line.description ?? "Charge",
    amountCents: line.amount,
    rentalLineId: matchRentalLineId(line.description, agreementLines),
  }));

  const appliedCreditCents = appliedBalanceCreditCents(stripeInvoice);
  let creditLines: Array<{
    kind: "CREDIT";
    description: string;
    amountCents: number;
    rentalLineId: null;
  }> = [];
  let shownCredits: Array<{ id: string; cents: number; complete: boolean }> = [];
  if (appliedCreditCents > 0) {
    await lockCustomerLedger(db, customerId);
    const unshown = await db.customerCredit.findMany({
      where: {
        customerId,
        sourceType: LATE_DELIVERY_CREDIT_SOURCE,
        appliedViaStripeAt: { not: null },
        shownOnInvoiceId: null,
      },
      orderBy: { appliedViaStripeAt: "asc" },
      select: { id: true, amountCents: true, shownCents: true, reason: true },
    });
    const split = creditLinesForAppliedBalance(
      appliedCreditCents,
      unshown.filter((credit) => credit.shownCents < credit.amountCents),
    );
    creditLines = split.lines;
    shownCredits = split.shown;
  }

  const mirroredChargeLines: MirroredStripeChargeLine[] = [];
  for (const line of providerLines) {
    const created = await db.invoiceLineItem.create({
      data: {
        invoiceId,
        kind: line.kind,
        description: line.description,
        amountCents: line.amountCents,
        rentalLineId: line.rentalLineId,
      },
      select: { id: true },
    });
    mirroredChargeLines.push({
      stripeLine: line.stripeLine,
      invoiceLineItemId: created.id,
      kind: line.kind,
      amountCents: line.amountCents,
    });
  }

  const taxCents = extractTaxCents(stripeInvoice);
  if (taxCents > 0) {
    await db.invoiceLineItem.create({
      data: {
        invoiceId,
        kind: "TAX",
        description: "Sales tax",
        amountCents: taxCents,
      },
    });
  }
  if (creditLines.length > 0) {
    await db.invoiceLineItem.createMany({
      data: creditLines.map((line) => ({ invoiceId, ...line })),
    });
  }

  await recordStripeInvoiceTaxEvidenceInTx(db, {
    invoiceId,
    agreementId,
    stripeInvoice,
    chargeLines: mirroredChargeLines,
  });

  for (const shown of shownCredits) {
    await db.customerCredit.update({
      where: { id: shown.id },
      data: {
        shownCents: { increment: shown.cents },
        ...(shown.complete ? { shownOnInvoiceId: invoiceId } : {}),
      },
    });
  }

  const subtotalCents =
    providerLines.reduce((sum, item) => sum + item.amountCents, 0) +
    creditLines.reduce((sum, item) => sum + item.amountCents, 0);

  return {
    subtotalCents,
    depositLineAmountCents:
      providerLines.find((item) => item.kind === "DEPOSIT")?.amountCents ?? null,
  };
}

async function recordPaidInvoice(
  db: Prisma.TransactionClient,
  evidence: WebhookEvidence,
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

  // An invoice can be written off by the owner at the very moment Stripe
  // reports it paid. Take the same locks the ledger uses (customer, then
  // invoice) and re-read the invoice before changing it, so the two can never
  // interleave into "paid" and "written off" at once.
  if (targetInvoiceId) {
    await lockCustomerLedger(db, customerId);
    const locked = await db.$queryRaw<Array<{ status: string }>>`
      SELECT "status" FROM "Invoice" WHERE "id" = ${targetInvoiceId} FOR UPDATE
    `;
    const lockedStatus = locked[0]?.status;
    if (lockedStatus === "PAID") return;
    if (lockedStatus === "WRITTEN_OFF" || lockedStatus === "VOID") {
      await holdPaymentForClosedInvoice(
        db,
        evidence,
        stripeInvoice,
        customerId,
        targetInvoiceId,
        lockedStatus,
      );
      return;
    }
  }

  const cashEvents = evidence.cashEvents(stripeInvoice.id as string);
  const taxCents = extractTaxCents(stripeInvoice);
  const nextBillingDate = stripeInvoice.period_end
    ? new Date(stripeInvoice.period_end * 1000)
    : null;

  const invoiceFields = {
    status:
      cashEvents.length === 0 || stripeInvoice.amount_due === 0
        ? ("PAID" as const)
        : ("OPEN" as const),
    billingPeriodStart: stripeInvoice.period_start
      ? new Date(stripeInvoice.period_start * 1000)
      : null,
    billingPeriodEnd: stripeInvoice.period_end
      ? new Date(stripeInvoice.period_end * 1000)
      : null,
    subtotalCents: stripeInvoice.subtotal,
    taxCents,
    amountDueCents: stripeInvoice.amount_due,
    amountPaidCents: 0,
    dueDate: stripeInvoice.due_date ? new Date(stripeInvoice.due_date * 1000) : null,
  };

  const invoice = targetInvoiceId
    ? await db.invoice.update({
        where: { id: targetInvoiceId },
        data: invoiceFields,
      })
    : await db.invoice.create({
        data: {
          customerId,
          agreementId,
          ...invoiceFields,
          stripeInvoiceId: stripeInvoice.id,
        },
      });

  const mirrored = await mirrorStripeInvoiceLines(
    db,
    stripeInvoice,
    agreementId,
    customerId,
    invoice.id,
  );
  if (invoice.subtotalCents !== mirrored.subtotalCents) {
    await db.invoice.update({
      where: { id: invoice.id },
      data: { subtotalCents: mirrored.subtotalCents },
    });
  }

  let allocatedToInvoiceCents = 0;
  for (const cashEvent of cashEvents) {
    const outstandingCents = Math.max(0, stripeInvoice.amount_due - allocatedToInvoiceCents);
    const appliedCents = Math.min(cashEvent.amountCents, outstandingCents);
    const { receiptId } = await createReceiptWithAllocations(db, {
      customerId,
      source: "STRIPE",
      amountCents: cashEvent.amountCents,
      method: cashEvent.method,
      receivedOn: cashEvent.receivedOn,
      stripeChargeId: cashEvent.stripeChargeId ?? undefined,
      allocations:
        appliedCents > 0 ? [{ invoiceId: invoice.id, amountCents: appliedCents }] : [],
    });
    await attachProviderIdsToReceiptPayments(db, {
      receiptId,
      stripePaymentIntentId: cashEvent.paymentIntentId,
      stripeChargeId: cashEvent.stripeChargeId,
    });
    allocatedToInvoiceCents += appliedCents;
  }

  if (mirrored.depositLineAmountCents !== null) {
    const existingDeposit = await db.deposit.findFirst({ where: { agreementId } });
    if (!existingDeposit) {
      await db.deposit.create({
        data: {
          agreementId,
          amountCents: mirrored.depositLineAmountCents,
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
  evidence: WebhookEvidence,
  agreementId: string,
  customerId: string,
  paymentIntentId: string,
): Promise<void> {
  const existingPayment = await db.payment.findFirst({
    where: {
      stripePaymentIntentId: paymentIntentId,
      status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] },
    },
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
  const paymentDetails = evidence.paymentDetails(paymentIntentId);
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
  evidence: WebhookEvidence,
  estimateId: string,
  customerId: string,
  paymentIntentId: string,
): Promise<void> {
  const estimate = await db.estimate.findUniqueOrThrow({
    where: { id: estimateId },
    select: { depositCents: true, depositPaidAt: true },
  });
  if (estimate.depositPaidAt || estimate.depositCents <= 0) return;

  const paymentDetails = evidence.paymentDetails(paymentIntentId);
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
  evidence: WebhookEvidence,
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

  const intent = evidence.paymentIntentWithMethod(paymentIntentId);
  const methodId = idOf(intent.payment_method);
  await recordSigningPaymentMethod(db, estimate.customerId, methodId);
  if (session.payment_status !== "paid") return;
  await recordEstimateDepositPayment(
    db,
    evidence,
    estimateId,
    estimate.customerId,
    paymentIntentId,
  );
}

async function handleCheckoutSessionCompleted(
  db: Prisma.TransactionClient,
  evidence: WebhookEvidence,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const estimateId = session.metadata?.estimateId;
  if (estimateId) {
    await handleEstimateDepositCheckoutCompleted(db, evidence, session, estimateId);
    return;
  }

  const agreementId = session.metadata?.agreementId;
  if (!agreementId) return;

  if (session.mode === "subscription") {
    if (!session.invoice) return;
    const invoiceId = idOf(session.invoice) as string;
    const stripeInvoice = evidence.invoice(invoiceId);
    if (stripeInvoice.status !== "paid") return;
    const agreement = await db.rentalAgreement.findUniqueOrThrow({
      where: { id: agreementId },
      select: { customerId: true },
    });
    await recordPaidInvoice(db, evidence, stripeInvoice, agreementId, agreement.customerId);
    return;
  }

  const agreement = await db.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: { customerId: true },
  });

  if (session.mode === "setup") {
    const setupIntentId = idOf(session.setup_intent);
    if (!setupIntentId) return;
    const intent = evidence.setupIntent(setupIntentId);
    const methodId = idOf(intent.payment_method);
    await recordSigningPaymentMethod(db, agreement.customerId, methodId);
    return;
  }

  if (session.mode === "payment") {
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentIntentId) return;

    const intent = evidence.paymentIntentWithMethod(paymentIntentId);
    const methodId = idOf(intent.payment_method);
    await recordSigningPaymentMethod(db, agreement.customerId, methodId);
    if (session.payment_status !== "paid") return;
    await recordOneTimeSigningCharge(
      db,
      evidence,
      agreementId,
      agreement.customerId,
      paymentIntentId,
    );
  }
}

async function handleCheckoutSessionAsyncPaymentSucceeded(
  db: Prisma.TransactionClient,
  evidence: WebhookEvidence,
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
    await recordEstimateDepositPayment(
      db,
      evidence,
      estimateId,
      estimate.customerId,
      paymentIntentId,
    );
    return;
  }

  const agreementId = session.metadata?.agreementId;
  if (!agreementId) return;
  const agreement = await db.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: { customerId: true },
  });
  await recordOneTimeSigningCharge(
    db,
    evidence,
    agreementId,
    agreement.customerId,
    paymentIntentId,
  );
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

async function rewardingReferralForCustomer(
  db: Prisma.TransactionClient,
  referredCustomerId: string,
): Promise<string | null> {
  const referral = await db.referral.findUnique({
    where: { referredCustomerId },
    select: { id: true, status: true },
  });
  return referral?.status === "REWARDING" ? referral.id : null;
}

async function handleInvoicePaid(
  db: Prisma.TransactionClient,
  evidence: WebhookEvidence,
  webhookInvoice: Stripe.Invoice,
): Promise<string | null> {
  const subscriptionId = extractSubscriptionId(webhookInvoice);
  if (!subscriptionId) return null;

  const agreement = await db.rentalAgreement.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true, customerId: true },
  });
  if (!agreement) return null;

  const alreadyRecorded = await db.invoice.findUnique({
    where: { stripeInvoiceId: webhookInvoice.id },
    select: { id: true, status: true, amountPaidCents: true },
  });

  if (alreadyRecorded?.status !== "PAID") {
    const stripeInvoice = evidence.invoice(webhookInvoice.id as string);
    await recordPaidInvoice(
      db,
      evidence,
      stripeInvoice,
      agreement.id,
      agreement.customerId,
      alreadyRecorded?.id,
    );
  }

  const paidInvoice = await db.invoice.findUnique({
    where: { stripeInvoiceId: webhookInvoice.id },
    select: { status: true, amountPaidCents: true },
  });
  if (paidInvoice?.status !== "PAID" || paidInvoice.amountPaidCents <= 0) {
    return rewardingReferralForCustomer(db, agreement.customerId);
  }

  const claimed = await rewardReferralOnFirstPaidInvoice(db, agreement.customerId);
  if (!claimed) return rewardingReferralForCustomer(db, agreement.customerId);

  const credit = await db.customerCredit.findUniqueOrThrow({
    where: { id: claimed.creditIds[0] },
    select: { sourceId: true },
  });
  return credit.sourceId;
}

async function handleInvoicePaymentFailed(
  db: Prisma.TransactionClient,
  evidence: WebhookEvidence,
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

  const stripeInvoice = evidence.invoice(webhookInvoice.id as string);
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

  const mirrored = await mirrorStripeInvoiceLines(
    db,
    stripeInvoice,
    agreement.id,
    agreement.customerId,
    invoice.id,
  );
  if (invoice.subtotalCents !== mirrored.subtotalCents) {
    await db.invoice.update({
      where: { id: invoice.id },
      data: { subtotalCents: mirrored.subtotalCents },
    });
  }

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

  const found = await db.payment.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { id: true, invoice: { select: { customerId: true } } },
  });
  if (!found) return;

  // Same lock order as the owner's held-payment decisions (customer, then the
  // payment row), so a Stripe refund and an owner decision can never both win.
  await lockCustomerLedger(db, found.invoice.customerId);
  const payment = await db.payment.findUnique({
    where: { id: found.id },
    select: { id: true, invoiceId: true, status: true, amountCents: true, receiptId: true, stripePaymentIntentId: true, stripeChargeId: true, method: true },
  });
  if (!payment) return;
  await db.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${payment.id} FOR UPDATE`;
  const locked = await db.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { status: true, amountCents: true } });

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

  if (locked.status === HELD_PAYMENT_STATUS) {
    // A held payment refunded in the Stripe dashboard no longer waits for the owner.
    // A partial refund leaves the rest held: the refunded part becomes its own settled row.
    const refundedPart = Math.min(newAmountCents, locked.amountCents);
    if (refundedPart >= locked.amountCents) {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: HELD_REFUNDED_STATUS, notes: "Held payment refunded in Stripe." },
      });
    } else {
      await db.payment.update({
        where: { id: payment.id },
        data: { amountCents: locked.amountCents - refundedPart },
      });
      await db.payment.create({
        data: {
          invoiceId: payment.invoiceId,
          receiptId: payment.receiptId,
          amountCents: refundedPart,
          method: payment.method,
          status: HELD_REFUNDED_STATUS,
          stripePaymentIntentId: payment.stripePaymentIntentId,
          stripeChargeId: payment.stripeChargeId,
          notes: "Part of a held payment refunded in Stripe.",
        },
      });
    }
  } else if (locked.status === HELD_TO_CREDIT_STATUS) {
    // The owner already kept this money as credit, and now Stripe returned it to the card.
    // An unspent credit is withdrawn; a partly spent one needs the owner's eyes.
    const credit = await db.customerCredit.findFirst({
      where: { sourceType: "HELD_PAYMENT", sourceId: payment.id, side: null },
      select: { id: true, amountCents: true, remainingCents: true },
    });
    if (credit && credit.remainingCents === credit.amountCents) {
      await db.customerCredit.update({ where: { id: credit.id }, data: { remainingCents: 0 } });
      await db.payment.update({
        where: { id: payment.id },
        data: { status: HELD_REFUNDED_STATUS, notes: "Refunded in Stripe; the credit that had been created was withdrawn." },
      });
    } else {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: HELD_CONFLICT_STATUS, notes: "Refunded in Stripe after the money was kept as credit and partly used." },
      });
    }
    await db.auditLog.create({
      data: {
        userId: null,
        action: "billing.held_credit_refunded_in_stripe",
        entityType: "Payment",
        entityId: payment.id,
        newValue: { creditWithdrawn: credit?.remainingCents === credit?.amountCents },
      },
    });
  }
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

async function referralSettlementForProcessedEvent(
  db: Prisma.TransactionClient,
  event: Stripe.Event,
): Promise<string[]> {
  if (event.type !== "invoice.paid") return [];
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = extractSubscriptionId(invoice);
  if (!subscriptionId) return [];
  const agreement = await db.rentalAgreement.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { customerId: true },
  });
  if (!agreement) return [];
  const referralId = await rewardingReferralForCustomer(db, agreement.customerId);
  return referralId ? [referralId] : [];
}

async function processLockedEvent(
  db: Prisma.TransactionClient,
  evidence: WebhookEvidence,
  event: Stripe.Event,
): Promise<string[]> {
  if (await alreadyProcessed(db, event.id)) {
    return referralSettlementForProcessedEvent(db, event);
  }

  const referralIdsToSettle: string[] = [];
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(
        db,
        evidence,
        event.data.object as Stripe.Checkout.Session,
      );
      break;
    case "checkout.session.async_payment_succeeded":
      await handleCheckoutSessionAsyncPaymentSucceeded(
        db,
        evidence,
        event.data.object as Stripe.Checkout.Session,
      );
      break;
    case "checkout.session.async_payment_failed":
      await handleCheckoutSessionAsyncPaymentFailed(
        db,
        event.data.object as Stripe.Checkout.Session,
      );
      break;
    case "invoice.paid": {
      const referralId = await handleInvoicePaid(
        db,
        evidence,
        event.data.object as Stripe.Invoice,
      );
      if (referralId) referralIdsToSettle.push(referralId);
      break;
    }
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(db, evidence, event.data.object as Stripe.Invoice);
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
  return referralIdsToSettle;
}

export type StripeWebhookProcessingResult = {
  referralIdsToSettle: string[];
};

/**
 * R08: how many times one delivery may re-fetch a Stripe fact that the locked
 * transaction found missing (local state changed between the early check and
 * the lock). Each retry adds exactly the missing item, so this terminates.
 */
const MAX_EVIDENCE_REFILLS = 5;

/**
 * Apply one Stripe event.
 *
 * 1. All Stripe reads happen first, with no transaction open (`gatherWebhookEvidence`).
 * 2. A short local transaction then takes ONE transaction-scoped advisory lock
 *    (the cross-customer serialization the ledger still needs), re-checks local
 *    rows, applies the event and inserts the WebhookEvent marker together. No
 *    network call happens while that lock or any row lock is held.
 * 3. Any handler failure rolls back both the business mutation and the marker,
 *    so route.ts can return 500 and Stripe can safely retry. Referral provider
 *    writes are returned to the route and happen only after the commit.
 */
export async function processStripeWebhookEvent(
  event: Stripe.Event,
): Promise<StripeWebhookProcessingResult> {
  const evidence = await gatherWebhookEvidence(event);
  for (let refill = 0; ; refill += 1) {
    try {
      const referralIdsToSettle = await prisma.$transaction(
        async (db) => {
          await db.$queryRaw`SELECT pg_advisory_xact_lock(174831, 1)::text`;
          return processLockedEvent(db, evidence, event);
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
      return { referralIdsToSettle };
    } catch (error) {
      if (!(error instanceof MissingWebhookEvidenceError) || refill >= MAX_EVIDENCE_REFILLS) {
        throw error;
      }
      // The transaction rolled back (nothing was recorded). Fetch exactly the
      // missing item with no lock held, then replay the local transaction.
      await evidence.fill(error.key);
    }
  }
}
