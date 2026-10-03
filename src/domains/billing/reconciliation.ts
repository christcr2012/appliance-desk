import type { ProviderOperationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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
  requestedAt: Date;
};

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

  // A successful retrieve that says the subscription is still live resolves
  // the original ambiguous outcome: cancellation did not take effect. It is
  // therefore safe to issue one more cancel request, even for UNKNOWN. Stripe
  // cancellation is idempotent; a later resource_missing is also success.
  const result = await runProviderCall(() =>
    stripe.subscriptions.cancel(subscriptionId),
  );
  await prisma.$transaction((tx) =>
    completeProviderOperation(
      tx,
      operation.id,
      result.ok
        ? { status: "SUCCEEDED", providerObjectId: subscriptionId }
        : { status: result.outcome, error: result.error },
    ),
  );
  return result.ok;
}

async function reconcileBalanceCredit(operation: RecoverableOperation): Promise<boolean> {
  const credit = await prisma.customerCredit.findUnique({
    where: { id: operation.subjectId },
    include: { customer: { select: { stripeCustomerId: true } } },
  });
  if (!credit?.customer.stripeCustomerId) return false;

  const stripe = getStripeClient();
  const transactions = await stripe.customers.listBalanceTransactions(
    credit.customer.stripeCustomerId,
    { limit: 100 },
  );
  const found = transactions.data.find(
    (transaction) => transaction.metadata?.creditId === credit.id,
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

  if (operation.status === "UNKNOWN") return false;

  let claim;
  try {
    claim = await prisma.$transaction((tx) =>
      claimProviderOperation(tx, {
        kind: "BALANCE_CREDIT",
        subjectType: operation.subjectType,
        subjectId: operation.subjectId,
        idempotencyKey: operation.idempotencyKey,
        staleAfterMs: 0,
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

async function reconcileRefund(operation: RecoverableOperation): Promise<boolean> {
  const stripe = getStripeClient();
  const refunds = await stripe.refunds.list({ limit: 100 });
  const found = refunds.data.find((refund) =>
    operation.subjectType === "Deposit"
      ? refund.metadata?.depositId === operation.subjectId
      : refund.metadata?.refundId === operation.subjectId,
  );
  if (!found) return false;

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

export async function finishPendingProviderOperations(
  limit = 50,
): Promise<{ completed: number; stillUnknown: number }> {
  const staleBefore = new Date(Date.now() - 120_000);
  const operations = await prisma.providerOperation.findMany({
    where: {
      OR: [
        { status: "PENDING", requestedAt: { lte: staleBefore } },
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
      requestedAt: true,
    },
    orderBy: { requestedAt: "asc" },
    take: Math.max(1, Math.min(limit, 200)),
  });

  let completed = 0;
  let stillUnknown = 0;
  for (const operation of operations) {
    try {
      if (await reconcileOne(operation)) completed += 1;
      else stillUnknown += 1;
    } catch (error) {
      console.error(
        `[billing-reconcile] Could not reconcile ${operation.kind} ${operation.id}`,
        error instanceof Error ? error.message : "unknown error",
      );
      stillUnknown += 1;
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
    where: { status: "succeeded", receiptId: null },
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
      await stripe.customers.retrieve(customer.stripeCustomerId);
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
