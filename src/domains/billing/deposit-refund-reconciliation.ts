import type { ProviderOperationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { SUCCESSFUL_PAYMENT_STATUSES } from "./payment-status";
import { resolveDepositRefundRail } from "./deposit-provenance";
import {
  claimProviderOperation,
  completeProviderOperation,
  RetryLater,
  runProviderCall,
} from "./provider-ops";

const PROVIDER_LOOKBACK_SECONDS = 300;
const MAX_PROVIDER_PAGES = 50;

type DepositRefundOperation = {
  id: string;
  subjectId: string;
  idempotencyKey: string;
  status: ProviderOperationStatus;
  attempts: number;
  requestedAt: Date;
};

type DepositReceiptOrigin =
  | { kind: "AGREEMENT"; agreementId: string }
  | { kind: "AGREEMENTLESS_DEPOSIT" }
  | null;

async function findProviderRefund(operation: DepositRefundOperation) {
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
    const found = page.data.find(
      (refund) => refund.metadata?.depositId === operation.subjectId,
    );
    if (found) return found;
    if (!page.has_more) return null;
    const last = page.data.at(-1);
    if (!last) return null;
    startingAfter = last.id;
  }
  return null;
}

async function sourceOriginForReceipt(
  receiptId: string,
): Promise<DepositReceiptOrigin> {
  const payment = await prisma.payment.findFirst({
    where: {
      receiptId,
      status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] },
      invoice: { lineItems: { some: { kind: "DEPOSIT" } } },
    },
    select: { invoice: { select: { agreementId: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!payment) return null;
  return payment.invoice.agreementId
    ? { kind: "AGREEMENT", agreementId: payment.invoice.agreementId }
    : { kind: "AGREEMENTLESS_DEPOSIT" };
}

/**
 * R06 recovery for deposit refunds whose immutable funding receipt no longer
 * belongs to the agreement that currently owns the liability. That includes
 * ordinary A -> B/C renewals and estimate-funded deposits, whose original
 * receipt is attached to an agreement-less estimate invoice. Provider evidence
 * is checked before every UNKNOWN retry, and the retry always uses the charge
 * on the immutable source receipt.
 */
export async function reconcileMovedDepositRefundOperations(
  limit = 50,
): Promise<{ completed: number }> {
  const bounded = Math.max(1, Math.min(limit, 200));
  const staleBefore = new Date(Date.now() - 120_000);
  const operations = await prisma.providerOperation.findMany({
    where: {
      kind: "REFUND_CREATE",
      subjectType: "Deposit",
      OR: [
        { status: "FAILED" },
        { status: "UNKNOWN" },
        { status: "PENDING", updatedAt: { lte: staleBefore } },
      ],
    },
    select: {
      id: true,
      subjectId: true,
      idempotencyKey: true,
      status: true,
      attempts: true,
      requestedAt: true,
    },
    orderBy: [{ updatedAt: "asc" }, { requestedAt: "asc" }],
    take: bounded,
  });

  let completed = 0;
  for (const operation of operations) {
    const deposit = await prisma.deposit.findUnique({
      where: { id: operation.subjectId },
      select: {
        agreementId: true,
        refundedAmountCents: true,
        stripeRefundId: true,
      },
    });
    if (!deposit?.refundedAmountCents || deposit.refundedAmountCents <= 0) continue;
    if (deposit.stripeRefundId) {
      await prisma.$transaction((tx) =>
        completeProviderOperation(tx, operation.id, {
          status: "SUCCEEDED",
          providerObjectId: deposit.stripeRefundId!,
        }),
      );
      completed += 1;
      continue;
    }

    let rail;
    try {
      rail = await resolveDepositRefundRail(operation.subjectId);
    } catch {
      // Fail closed. The normal reconciliation workbench will keep the durable
      // provider operation visible until provenance can be proven.
      continue;
    }
    if (rail.kind !== "STRIPE") continue;

    const sourceOrigin = await sourceOriginForReceipt(rail.receiptId);
    if (!sourceOrigin) continue;
    // Same-agreement refunds remain owned by the legacy reconciler. An
    // agreement-less deposit receipt is estimate-funded and must be handled
    // here because renewal does not copy sourceEstimateId forward.
    if (
      sourceOrigin.kind === "AGREEMENT" &&
      sourceOrigin.agreementId === deposit.agreementId
    ) {
      continue;
    }

    const providerRefund = await findProviderRefund(operation);
    if (providerRefund) {
      await prisma.$transaction(async (tx) => {
        await tx.deposit.updateMany({
          where: { id: operation.subjectId, stripeRefundId: null },
          data: { stripeRefundId: providerRefund.id },
        });
        await completeProviderOperation(tx, operation.id, {
          status: "SUCCEEDED",
          providerObjectId: providerRefund.id,
        });
      });
      completed += 1;
      continue;
    }

    let claim;
    try {
      claim = await prisma.$transaction((tx) =>
        claimProviderOperation(tx, {
          kind: "REFUND_CREATE",
          subjectType: "Deposit",
          subjectId: operation.subjectId,
          idempotencyKey: operation.idempotencyKey,
          ...(operation.status === "UNKNOWN"
            ? {
                reconcileUnknownAfterProviderEvidence: {
                  expectedAttempts: operation.attempts,
                },
              }
            : {}),
        }),
      );
    } catch (error) {
      if (error instanceof RetryLater) continue;
      throw error;
    }

    if (claim.done) {
      await prisma.deposit.updateMany({
        where: { id: operation.subjectId, stripeRefundId: null },
        data: { stripeRefundId: claim.providerObjectId },
      });
      completed += 1;
      continue;
    }

    const stripe = getStripeClient();
    const result = await runProviderCall(() =>
      stripe.refunds.create(
        {
          charge: rail.stripeChargeId,
          amount: deposit.refundedAmountCents!,
          metadata: { depositId: operation.subjectId },
        },
        { idempotencyKey: claim.idempotencyKey },
      ),
    );

    await prisma.$transaction(async (tx) => {
      if (result.ok) {
        await tx.deposit.updateMany({
          where: { id: operation.subjectId, stripeRefundId: null },
          data: { stripeRefundId: result.value.id },
        });
      }
      await completeProviderOperation(
        tx,
        claim.opId,
        result.ok
          ? { status: "SUCCEEDED", providerObjectId: result.value.id }
          : { status: result.outcome, error: result.error },
      );
    });
    if (result.ok) completed += 1;
  }

  return { completed };
}
