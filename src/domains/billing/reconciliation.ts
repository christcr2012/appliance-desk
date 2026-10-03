import type { ProviderOperationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SUCCESSFUL_PAYMENT_STATUSES } from "./payment-status";
import { getStripeClient } from "@/lib/stripe";
import {
  claimProviderOperation,
  completeProviderOperation,
  RetryLater,
  runProviderCall,
} from "./provider-ops";

export type DriftRow = {
  kind:
    | "PENDING_OP"
    | "UNKNOWN_OP"
    | "FAILED_OP"
    | "SUB_LIVE_BUT_LOCAL_CLOSED"
    | "LOCAL_ACTIVE_NO_SUB"
    | "STRIPE_CUSTOMER_MISSING"
    | "INVOICE_STATUS_MISMATCH"
    | "PAYMENT_WITHOUT_RECEIPT";
  subjectType: string;
  subjectId: string;
  detail: string;
  since: Date;
};

type RecoverableOperation = {
  id: string;
  kind:
    | "CUSTOMER_CREATE"
    | "SUBSCRIPTION_CREATE"
    | "SUBSCRIPTION_CANCEL"
    | "BALANCE_CREDIT"
    | "REFUND_CREATE";
  subjectType: string;
  subjectId: string;
  idempotencyKey: string;
  status: ProviderOperationStatus;
  attempts: number;
  requestedAt: Date;
};

const PROVIDER_LOOKBACK_SECONDS = 300;
const MAX_PROVIDER_PAGES = 50;

function missingResource(error: unknown): boolean {
  const value = error as { type?: string; code?: string };
  return value.type === "StripeInvalidRequestError" && value.code === "resource_missing";
}

async function markOperationSucceeded(
  operation: RecoverableOperation,
  providerObjectId: string,
): Promise<void> {
  await prisma.$transaction((tx) =>
    completeProviderOperation(tx, operation.id, {
      status: "SUCCEEDED",
      providerObjectId,
    }),
  );
}

async function reconcileCustomerCreate(operation: RecoverableOperation): Promise<boolean> {
  const stripe = getStripeClient();
  const found = await stripe.customers.search({
    query: `metadata['customerId']:'${operation.subjectId}'`,
    limit: 10,
  });
  const customer = found.data[0];
  if (!customer) return false;

  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ stripeCustomerId: string | null }>>`
      SELECT "stripeCustomerId"
      FROM "Customer"
      WHERE "id" = ${operation.subjectId}
      FOR UPDATE
    `;
    const local = rows[0];
    if (!local) {
      await completeProviderOperation(tx, operation.id, {
        status: "DRIFT",
        providerObjectId: customer.id,
        note: "Stripe customer exists but the local Customer row is missing.",
      });
      return;
    }
    if (local.stripeCustomerId && local.stripeCustomerId !== customer.id) {
      await completeProviderOperation(tx, operation.id, {
        status: "DRIFT",
        providerObjectId: customer.id,
        note: `Local customer is linked to ${local.stripeCustomerId}, not recovered ${customer.id}.`,
      });
      return;
    }
    if (!local.stripeCustomerId) {
      await tx.customer.update({
        where: { id: operation.subjectId },
        data: { stripeCustomerId: customer.id },
      });
    }
    await completeProviderOperation(tx, operation.id, {
      status: "SUCCEEDED",
      providerObjectId: customer.id,
    });
  });
  return true;
}

async function reconcileSubscriptionCreate(operation: RecoverableOperation): Promise<boolean> {
  const stripe = getStripeClient();
  const found = await stripe.subscriptions.search({
    query: `metadata['agreementId']:'${operation.subjectId}'`,
    limit: 10,
  });
  const subscription = found.data[0];
  if (!subscription) return false;

  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ stripeSubscriptionId: string | null }>>`
      SELECT "stripeSubscriptionId"
      FROM "RentalAgreement"
      WHERE "id" = ${operation.subjectId}
      FOR UPDATE
    `;
    const local = rows[0];
    if (!local) {
      await completeProviderOperation(tx, operation.id, {
        status: "DRIFT",
        providerObjectId: subscription.id,
        note: "Stripe subscription exists but the local agreement is missing.",
      });
      return;
    }
    if (local.stripeSubscriptionId && local.stripeSubscriptionId !== subscription.id) {
      await completeProviderOperation(tx, operation.id, {
        status: "DRIFT",
        providerObjectId: subscription.id,
        note: `Local agreement is linked to ${local.stripeSubscriptionId}, not recovered ${subscription.id}.`,
      });
      return;
    }
    if (!local.stripeSubscriptionId) {
      await tx.rentalAgreement.update({
        where: { id: operation.subjectId },
        data: { stripeSubscriptionId: subscription.id },
      });
    }
    await completeProviderOperation(tx, operation.id, {
      status: "SUCCEEDED",
      providerObjectId: subscription.id,
    });
  });
  return true;
}

async function reconcileSubscriptionCancel(operation: RecoverableOperation): Promise<boolean> {
  const agreement = await prisma.rentalAgreement.findUnique({
    where: { id: operation.subjectId },
    select: { stripeSubscriptionId: true },
  });
  const subscriptionId = agreement?.stripeSubscriptionId;
  if (!subscriptionId) return false;

  const stripe = getStripeClient();
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (subscription.status === "canceled") {
      await markOperationSucceeded(operation, subscriptionId);
      return true;
    }
  } catch (error) {
    if (missingResource(error)) {
      await markOperationSucceeded(operation, subscriptionId);
      return true;
    }
    throw error;
  }

  // A successful retrieve proving the subscription is still live resolves an
  // earlier ambiguous cancel outcome. Reclaim the durable operation only if
  // the exact attempt observed before that provider read is still current.
  // This prevents stale evidence from authorizing another retry after a
  // competing worker has already issued a newer ambiguous provider attempt.
  let claim;
  try {
    claim = await prisma.$transaction((tx) =>
      claimProviderOperation(tx, {
        kind: "SUBSCRIPTION_CANCEL",
        subjectType: operation.subjectType,
        subjectId: operation.subjectId,
        idempotencyKey: operation.idempotencyKey,
        reconcileUnknownAfterProviderEvidence: {
          expectedAttempts: operation.attempts,
        },
      }),
    );
  } catch (error) {
    if (error instanceof RetryLater) return false;
    throw error;
  }
  if (claim.done) return true;

  const result = await runProviderCall(() =>
    stripe.subscriptions.cancel(subscriptionId, undefined, {
      idempotencyKey: claim.idempotencyKey,
    }),
  );
  await prisma.$transaction((tx) =>
    completeProviderOperation(
      tx,
      claim.opId,
      result.ok
        ? { status: "SUCCEEDED", providerObjectId: subscriptionId }
        : { status: result.outcome, error: result.error },
    ),
  );
  return result.ok;
}

async function findBalanceCreditTransaction(
  customerId: string,
  creditId: string,
  requestedAt: Date,
) {
  const stripe = getStripeClient();
  const cutoff = Math.floor(requestedAt.getTime() / 1000) - PROVIDER_LOOKBACK_SECONDS;
  let startingAfter: string | undefined;

  for (let pageNumber = 0; pageNumber < MAX_PROVIDER_PAGES; pageNumber++) {
    const page = await stripe.customers.listBalanceTransactions(customerId, {
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const found = page.data.find(
      (transaction) => transaction.metadata?.creditId === creditId,
    );
    if (found) return found;

    const oldest = page.data.at(-1);
    if (!page.has_more || !oldest || oldest.created < cutoff) return null;
    startingAfter = oldest.id;
  }

  return null;
}

async function reconcileBalanceCredit(operation: RecoverableOperation): Promise<boolean> {
  const credit = await prisma.customerCredit.findUnique({
    where: { id: operation.subjectId },
    include: { customer: { select: { stripeCustomerId: true } } },
  });
  if (!credit?.customer.stripeCustomerId) return false;

  const stripe = getStripeClient();
  const found = await findBalanceCreditTransaction(
    credit.customer.stripeCustomerId,
    credit.id,
    operation.requestedAt,
  );
  if (found) {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ appliedViaStripeAt: Date | null }>>`
        SELECT "appliedViaStripeAt"
        FROM "CustomerCredit"
        WHERE "id" = ${credit.id}
        FOR UPDATE
      `;
      if (rows[0] && !rows[0].appliedViaStripeAt) {
        await tx.customerCredit.update({
          where: { id: credit.id },
          data: { appliedViaStripeAt: new Date(), remainingCents: 0 },
        });
      }
      await completeProviderOperation(tx, operation.id, {
        status: "SUCCEEDED",
        providerObjectId: found.id,
      });
    });
    return true;
  }

  // UNKNOWN is never guessed at or blindly replayed. Provider evidence must
  // resolve it. Definite FAILED or stale PENDING operations can reuse the same
  // idempotency key safely. claimProviderOperation enforces the normal lease
  // before a PENDING takeover so overlapping reconcilers cannot steal a fresh
  // retry from one another.
  if (operation.status === "UNKNOWN") return false;

  let claim;
  try {
    claim = await prisma.$transaction((tx) =>
      claimProviderOperation(tx, {
        kind: "BALANCE_CREDIT",
        subjectType: operation.subjectType,
        subjectId: operation.subjectId,
        idempotencyKey: operation.idempotencyKey,
      }),
    );
  } catch (error) {
    if (error instanceof RetryLater) return false;
    throw error;
  }
  if (claim.done) {
    await markOperationSucceeded(operation, claim.providerObjectId);
    return true;
  }

  const result = await runProviderCall(() =>
    stripe.customers.createBalanceTransaction(
      credit.customer.stripeCustomerId!,
      {
        amount: -credit.amountCents,
        currency: "usd",
        description: credit.reason,
        metadata: { creditId: credit.id, sourceId: credit.sourceId ?? "" },
      },
      { idempotencyKey: claim.idempotencyKey },
    ),
  );
  await prisma.$transaction(async (tx) => {
    if (result.ok) {
      await tx.customerCredit.update({
        where: { id: credit.id },
        data: { appliedViaStripeAt: new Date(), remainingCents: 0 },
      });
      await completeProviderOperation(tx, claim.opId, {
        status: "SUCCEEDED",
        providerObjectId: result.value.id,
      });
    } else {
      await completeProviderOperation(tx, claim.opId, {
        status: result.outcome,
        error: result.error,
      });
    }
  });
  return result.ok;
}

async function findProviderRefund(operation: RecoverableOperation) {
  const stripe = getStripeClient();
  const createdGte =
    Math.floor(operation.requestedAt.getTime() / 1000) - PROVIDER_LOOKBACK_SECONDS;
  let startingAfter: string | undefined;

  for (let pageNumber = 0; pageNumber < MAX_PROVIDER_PAGES; pageNumber++) {
    const page = await stripe.refunds.list({
      limit: 100,
      created: { gte: createdGte },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const found = page.data.find((refund) =>
      operation.subjectType === "Deposit"
        ? refund.metadata?.depositId === operation.subjectId
        : refund.metadata?.refundId === operation.subjectId,
    );
    if (found) return found;
    if (!page.has_more) return null;
    const last = page.data.at(-1);
    if (!last) return null;
    startingAfter = last.id;
  }

  return null;
}

function refundChargeFromOperation(operation: RecoverableOperation): string | null {
  if (operation.subjectType !== "Refund") return null;
  const prefix = `invoice-refund-${operation.subjectId}-charge-`;
  return operation.idempotencyKey.startsWith(prefix)
    ? operation.idempotencyKey.slice(prefix.length) || null
    : null;
}

async function resolveDepositRefundCharge(depositId: string): Promise<{
  amountCents: number;
  stripeChargeId: string;
} | null> {
  const deposit = await prisma.deposit.findUnique({
    where: { id: depositId },
    select: {
      agreementId: true,
      refundedAmountCents: true,
      agreement: {
        select: {
          sourceEstimateId: true,
          customer: { select: { stripeCustomerId: true } },
        },
      },
    },
  });
  if (!deposit?.refundedAmountCents || deposit.refundedAmountCents <= 0) return null;

  const linkedPayment = await prisma.payment.findFirst({
    where: {
      status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] },
      invoice: {
        agreementId: deposit.agreementId,
        lineItems: { some: { kind: "DEPOSIT" } },
      },
      receipt: { source: "STRIPE", stripeChargeId: { not: null } },
    },
    select: { receipt: { select: { stripeChargeId: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (linkedPayment?.receipt?.stripeChargeId) {
    return {
      amountCents: deposit.refundedAmountCents,
      stripeChargeId: linkedPayment.receipt.stripeChargeId,
    };
  }

  const estimateId = deposit.agreement.sourceEstimateId;
  const customerId = deposit.agreement.customer.stripeCustomerId;
  if (!estimateId || !customerId) return null;

  const stripe = getStripeClient();
  let startingAfter: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_PROVIDER_PAGES; pageNumber++) {
    const page = await stripe.checkout.sessions.list({
      customer: customerId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const session = page.data.find(
      (candidate) =>
        candidate.metadata?.estimateId === estimateId &&
        candidate.payment_status === "paid" &&
        candidate.payment_intent,
    );
    if (session?.payment_intent) {
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent.id;
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge"],
      });
      const charge = intent.latest_charge;
      if (!charge) return null;
      return {
        amountCents: deposit.refundedAmountCents,
        stripeChargeId: typeof charge === "string" ? charge : charge.id,
      };
    }
    if (!page.has_more) return null;
    const last = page.data.at(-1);
    if (!last) return null;
    startingAfter = last.id;
  }

  return null;
}

async function retryDefiniteRefundFailure(
  operation: RecoverableOperation,
): Promise<boolean> {
  if (operation.status === "UNKNOWN") return false;

  let amountCents: number;
  let stripeChargeId: string;
  let metadata: Record<string, string>;

  if (operation.subjectType === "Refund") {
    const refund = await prisma.refund.findUnique({
      where: { id: operation.subjectId },
      select: { amountCents: true, invoiceId: true },
    });
    const chargeId = refundChargeFromOperation(operation);
    if (!refund || !chargeId) return false;
    amountCents = refund.amountCents;
    stripeChargeId = chargeId;
    metadata = { refundId: operation.subjectId, invoiceId: refund.invoiceId };
  } else if (operation.subjectType === "Deposit") {
    const deposit = await resolveDepositRefundCharge(operation.subjectId);
    if (!deposit) return false;
    amountCents = deposit.amountCents;
    stripeChargeId = deposit.stripeChargeId;
    metadata = { depositId: operation.subjectId };
  } else {
    return false;
  }

  let claim;
  try {
    claim = await prisma.$transaction((tx) =>
      claimProviderOperation(tx, {
        kind: "REFUND_CREATE",
        subjectType: operation.subjectType,
        subjectId: operation.subjectId,
        idempotencyKey: operation.idempotencyKey,
      }),
    );
  } catch (error) {
    if (error instanceof RetryLater) return false;
    throw error;
  }
  if (claim.done) {
    await markOperationSucceeded(operation, claim.providerObjectId);
    return true;
  }

  const stripe = getStripeClient();
  const result = await runProviderCall(() =>
    stripe.refunds.create(
      { charge: stripeChargeId, amount: amountCents, metadata },
      { idempotencyKey: claim.idempotencyKey },
    ),
  );

  await prisma.$transaction(async (tx) => {
    if (result.ok) {
      if (operation.subjectType === "Deposit") {
        await tx.deposit.updateMany({
          where: { id: operation.subjectId, stripeRefundId: null },
          data: { stripeRefundId: result.value.id },
        });
      } else {
        await tx.refund.updateMany({
          where: { id: operation.subjectId, stripeRefundId: null },
          data: { stripeRefundId: result.value.id },
        });
      }
      await completeProviderOperation(tx, claim.opId, {
        status: "SUCCEEDED",
        providerObjectId: result.value.id,
      });
    } else {
      await completeProviderOperation(tx, claim.opId, {
        status: result.outcome,
        error: result.error,
      });
    }
  });
  return result.ok;
}

async function reconcileRefund(operation: RecoverableOperation): Promise<boolean> {
  const found = await findProviderRefund(operation);
  if (found) {
    await prisma.$transaction(async (tx) => {
      if (operation.subjectType === "Deposit") {
        await tx.deposit.updateMany({
          where: { id: operation.subjectId, stripeRefundId: null },
          data: { stripeRefundId: found.id },
        });
      } else if (operation.subjectType === "Refund") {
        await tx.refund.updateMany({
          where: { id: operation.subjectId, stripeRefundId: null },
          data: { stripeRefundId: found.id },
        });
      }
      await completeProviderOperation(tx, operation.id, {
        status: "SUCCEEDED",
        providerObjectId: found.id,
      });
    });
    return true;
  }

  return retryDefiniteRefundFailure(operation);
}

async function reconcileOne(operation: RecoverableOperation): Promise<boolean> {
  switch (operation.kind) {
    case "CUSTOMER_CREATE":
      return reconcileCustomerCreate(operation);
    case "SUBSCRIPTION_CREATE":
      return reconcileSubscriptionCreate(operation);
    case "SUBSCRIPTION_CANCEL":
      return reconcileSubscriptionCancel(operation);
    case "BALANCE_CREDIT":
      return reconcileBalanceCredit(operation);
    case "REFUND_CREATE":
      return reconcileRefund(operation);
  }
}

async function rotateUnresolvedProviderOperation(operationId: string): Promise<void> {
  // Preserve requestedAt because provider evidence lookback is anchored to the
  // original provider request. Touch only updatedAt so an unresolved row moves
  // behind work that has not yet received a reconciliation attempt.
  await prisma.providerOperation.update({
    where: { id: operationId },
    data: { updatedAt: new Date() },
  });
}

export async function finishPendingProviderOperations(
  limit = 50,
): Promise<{ completed: number; stillUnknown: number }> {
  const staleBefore = new Date(Date.now() - 120_000);
  const operations = await prisma.providerOperation.findMany({
    where: {
      OR: [
        { status: "PENDING", updatedAt: { lte: staleBefore } },
        { status: "UNKNOWN" },
        { status: "FAILED" },
      ],
    },
    select: {
      id: true,
      kind: true,
      subjectType: true,
      subjectId: true,
      idempotencyKey: true,
      status: true,
      attempts: true,
      requestedAt: true,
    },
    orderBy: [{ updatedAt: "asc" }, { requestedAt: "asc" }],
    take: Math.max(1, Math.min(limit, 200)),
  });

  let completed = 0;
  let stillUnknown = 0;
  for (const operation of operations) {
    try {
      if (await reconcileOne(operation)) {
        completed += 1;
      } else {
        stillUnknown += 1;
        await rotateUnresolvedProviderOperation(operation.id);
      }
    } catch (error) {
      console.error(
        `[billing-reconcile] Could not reconcile ${operation.kind} ${operation.id}`,
        error instanceof Error ? error.message : "unknown error",
      );
      stillUnknown += 1;
      await rotateUnresolvedProviderOperation(operation.id);
    }
  }
  return { completed, stillUnknown };
}

function providerStatusKind(status: ProviderOperationStatus): DriftRow["kind"] | null {
  if (status === "PENDING") return "PENDING_OP";
  if (status === "UNKNOWN") return "UNKNOWN_OP";
  if (status === "FAILED") return "FAILED_OP";
  return null;
}

/**
 * Bounded, read-only drift inspection. No create/update/delete is performed;
 * provider reads are used only to compare external state with local truth.
 */
export async function detectDrift(limit = 200): Promise<DriftRow[]> {
  const bounded = Math.max(1, Math.min(limit, 500));
  const rows: DriftRow[] = [];

  const operations = await prisma.providerOperation.findMany({
    where: { status: { in: ["PENDING", "UNKNOWN", "FAILED"] } },
    orderBy: { requestedAt: "asc" },
    take: bounded,
  });
  for (const operation of operations) {
    const kind = providerStatusKind(operation.status);
    if (!kind) continue;
    rows.push({
      kind,
      subjectType: operation.subjectType,
      subjectId: operation.subjectId,
      detail: `${operation.kind} is ${operation.status.toLowerCase()} after ${operation.attempts} attempt${operation.attempts === 1 ? "" : "s"}.`,
      since: operation.requestedAt,
    });
  }
  if (rows.length >= bounded) return rows.slice(0, bounded);

  const activeNoSub = await prisma.rentalAgreement.findMany({
    where: {
      status: "ACTIVE",
      billingStartedAt: { not: null },
      stripeSubscriptionId: null,
    },
    select: { id: true, updatedAt: true },
    take: bounded - rows.length,
  });
  rows.push(
    ...activeNoSub.map((agreement) => ({
      kind: "LOCAL_ACTIVE_NO_SUB" as const,
      subjectType: "RentalAgreement",
      subjectId: agreement.id,
      detail: "Billing is marked started locally, but no Stripe subscription id is linked.",
      since: agreement.updatedAt,
    })),
  );
  if (rows.length >= bounded) return rows.slice(0, bounded);

  const invoiceCandidates = await prisma.invoice.findMany({
    where: {
      status: { in: ["PAID", "OPEN", "PARTIALLY_PAID", "DELINQUENT"] },
    },
    select: {
      id: true,
      status: true,
      amountDueCents: true,
      amountPaidCents: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: Math.min(500, Math.max(50, (bounded - rows.length) * 4)),
  });
  for (const invoice of invoiceCandidates) {
    if (rows.length >= bounded) break;
    const paidButShort =
      invoice.status === "PAID" && invoice.amountPaidCents < invoice.amountDueCents;
    const openButCovered =
      invoice.status !== "PAID" && invoice.amountPaidCents >= invoice.amountDueCents;
    if (!paidButShort && !openButCovered) continue;
    rows.push({
      kind: "INVOICE_STATUS_MISMATCH",
      subjectType: "Invoice",
      subjectId: invoice.id,
      detail: `${invoice.status} invoice has ${invoice.amountPaidCents}¢ paid against ${invoice.amountDueCents}¢ due.`,
      since: invoice.updatedAt,
    });
  }
  if (rows.length >= bounded) return rows.slice(0, bounded);

  const paymentsWithoutReceipt = await prisma.payment.findMany({
    where: { status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] }, receiptId: null },
    select: { id: true, invoiceId: true, createdAt: true },
    take: bounded - rows.length,
  });
  rows.push(
    ...paymentsWithoutReceipt.map((payment) => ({
      kind: "PAYMENT_WITHOUT_RECEIPT" as const,
      subjectType: "Payment",
      subjectId: payment.id,
      detail: `Succeeded payment on invoice ${payment.invoiceId} has no Receipt ledger event.`,
      since: payment.createdAt,
    })),
  );
  if (rows.length >= bounded) return rows.slice(0, bounded);

  let stripe;
  try {
    stripe = getStripeClient();
  } catch {
    return rows;
  }

  const closedWithSub = await prisma.rentalAgreement.findMany({
    where: {
      status: { in: ["ENDED", "CANCELLED"] },
      stripeSubscriptionId: { not: null },
    },
    select: { id: true, stripeSubscriptionId: true, updatedAt: true },
    take: Math.min(50, bounded - rows.length),
  });
  for (const agreement of closedWithSub) {
    if (!agreement.stripeSubscriptionId || rows.length >= bounded) break;
    try {
      const subscription = await stripe.subscriptions.retrieve(
        agreement.stripeSubscriptionId,
      );
      if (subscription.status !== "canceled") {
        rows.push({
          kind: "SUB_LIVE_BUT_LOCAL_CLOSED",
          subjectType: "RentalAgreement",
          subjectId: agreement.id,
          detail: `Local agreement is closed but Stripe subscription ${agreement.stripeSubscriptionId} is ${subscription.status}.`,
          since: agreement.updatedAt,
        });
      }
    } catch (error) {
      if (!missingResource(error)) throw error;
    }
  }
  if (rows.length >= bounded) return rows.slice(0, bounded);

  const customers = await prisma.customer.findMany({
    where: { stripeCustomerId: { not: null } },
    select: { id: true, stripeCustomerId: true, updatedAt: true },
    take: Math.min(50, bounded - rows.length),
  });
  for (const customer of customers) {
    if (!customer.stripeCustomerId || rows.length >= bounded) break;
    try {
      const remoteCustomer = await stripe.customers.retrieve(customer.stripeCustomerId);
      if ("deleted" in remoteCustomer && remoteCustomer.deleted) {
        rows.push({
          kind: "STRIPE_CUSTOMER_MISSING",
          subjectType: "Customer",
          subjectId: customer.id,
          detail: `Local customer points to deleted Stripe customer ${customer.stripeCustomerId}.`,
          since: customer.updatedAt,
        });
      }
    } catch (error) {
      if (!missingResource(error)) throw error;
      rows.push({
        kind: "STRIPE_CUSTOMER_MISSING",
        subjectType: "Customer",
        subjectId: customer.id,
        detail: `Local customer points to missing Stripe customer ${customer.stripeCustomerId}.`,
        since: customer.updatedAt,
      });
    }
  }

  return rows.slice(0, bounded);
}
