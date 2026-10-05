import type { Prisma, RefundReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { lockCustomerLedger } from "./ledger";
import {
  HELD_PAYMENT_STATUS,
  HELD_REFUNDED_STATUS,
  SUCCESSFUL_PAYMENT_STATUSES,
} from "./payment-status";
import {
  claimProviderOperation,
  completeProviderOperation,
  runProviderCall,
} from "./provider-ops";

function positiveCents(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive whole number of cents.`);
  }
}

export type ClaimedRefund = {
  providerOpId: string;
  idempotencyKey: string;
  stripeChargeId: string;
};

function invoiceRefundProviderKey(refundId: string, stripeChargeId: string): string {
  return `invoice-refund-${refundId}-charge-${stripeChargeId}`;
}

function chargeFromInvoiceRefundProviderKey(refundId: string, key: string): string | null {
  const prefix = `invoice-refund-${refundId}-charge-`;
  return key.startsWith(prefix) ? key.slice(prefix.length) || null : null;
}

async function executeStripeRefund(input: {
  claim: ClaimedRefund;
  amountCents: number;
  metadata: Record<string, string>;
  onSuccess: (tx: Prisma.TransactionClient, refundId: string) => Promise<void>;
}): Promise<"SUCCEEDED" | "FAILED" | "UNKNOWN"> {
  const stripe = getStripeClient();
  const result = await runProviderCall(() =>
    stripe.refunds.create(
      {
        charge: input.claim.stripeChargeId,
        amount: input.amountCents,
        metadata: input.metadata,
      },
      { idempotencyKey: input.claim.idempotencyKey },
    ),
  );

  await prisma.$transaction(async (tx) => {
    if (result.ok) {
      await input.onSuccess(tx, result.value.id);
      await completeProviderOperation(tx, input.claim.providerOpId, {
        status: "SUCCEEDED",
        providerObjectId: result.value.id,
      });
      return;
    }
    await completeProviderOperation(tx, input.claim.providerOpId, {
      status: result.outcome,
      error: result.error,
    });
  });
  return result.ok ? "SUCCEEDED" : result.outcome;
}

/**
 * Resolve the original Stripe charge before the deposit decision transaction.
 * Normal agreement deposits use their Receipt directly. Estimate deposits made
 * before an agreement existed are recovered through the agreement's immutable
 * sourceEstimateId and the paid Checkout Session metadata. No provider network
 * call is held under a database row lock.
 */
async function resolveDepositStripeCharge(depositId: string): Promise<string | null> {
  const deposit = await prisma.deposit.findUnique({
    where: { id: depositId },
    select: {
      agreementId: true,
      agreement: {
        select: {
          sourceEstimateId: true,
          customer: { select: { stripeCustomerId: true } },
        },
      },
    },
  });
  if (!deposit) return null;

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
    return linkedPayment.receipt.stripeChargeId;
  }

  const estimateId = deposit.agreement.sourceEstimateId;
  const stripeCustomerId = deposit.agreement.customer.stripeCustomerId;
  if (!estimateId || !stripeCustomerId) return null;

  const stripe = getStripeClient();
  const sessions = await stripe.checkout.sessions.list({
    customer: stripeCustomerId,
    limit: 100,
  });
  const session = sessions.data.find(
    (candidate) =>
      candidate.metadata?.estimateId === estimateId &&
      candidate.payment_status === "paid" &&
      candidate.payment_intent,
  );
  if (!session?.payment_intent) return null;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent.id;
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge"],
  });
  const latestCharge = intent.latest_charge;
  if (!latestCharge) return null;
  return typeof latestCharge === "string" ? latestCharge : latestCharge.id;
}

export async function decideDepositRefund(
  userId: string,
  input: {
    depositId: string;
    refundCents: number;
    deductionReason?: string;
    disputeNotes?: string;
    expectedVersion?: number;
  },
): Promise<{ providerOpId: string | null }> {
  positiveCents(input.refundCents, "Refund amount");
  if (input.expectedVersion !== undefined) {
    throw new Error(
      "Deposit version checking is not available in the approved Batch B schema; refresh and submit without expectedVersion.",
    );
  }

  const resolvedStripeChargeId = await resolveDepositStripeCharge(input.depositId);

  const prepared = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        agreementId: string;
        amountCents: number;
        refundable: boolean;
        refundedAt: Date | null;
        stripeRefundId: string | null;
      }>
    >`
      SELECT "id", "agreementId", "amountCents", "refundable", "refundedAt", "stripeRefundId"
      FROM "Deposit"
      WHERE "id" = ${input.depositId}
      FOR UPDATE
    `;
    const deposit = rows[0];
    if (!deposit) throw new Error("Couldn't find that deposit.");
    if (!deposit.refundable) throw new Error("This deposit is marked non-refundable.");
    if (deposit.refundedAt) throw new Error("This deposit already has a refund decision.");
    if (input.refundCents > deposit.amountCents) {
      throw new Error("Deposit refund cannot exceed the amount originally collected.");
    }
    const deductionReason = input.deductionReason?.trim() || null;
    if (input.refundCents < deposit.amountCents && !deductionReason) {
      throw new Error("A partial deposit refund requires a deduction reason.");
    }

    await tx.deposit.update({
      where: { id: deposit.id },
      data: {
        refundedAt: new Date(),
        refundedAmountCents: input.refundCents,
        deductionReason,
        refundedByUserId: userId,
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "deposit.refund_decided",
        entityType: "Deposit",
        entityId: deposit.id,
        newValue: {
          refundCents: input.refundCents,
          deductionReason,
          disputeNotes: input.disputeNotes?.trim() || null,
          returnMethod: resolvedStripeChargeId ? "stripe" : "manual",
        },
      },
    });

    if (!resolvedStripeChargeId) return { claim: null as ClaimedRefund | null };

    const claim = await claimProviderOperation(tx, {
      kind: "REFUND_CREATE",
      subjectType: "Deposit",
      subjectId: deposit.id,
      idempotencyKey: `deposit-refund-${deposit.id}`,
    });
    if (claim.done) {
      await tx.deposit.update({
        where: { id: deposit.id },
        data: { stripeRefundId: claim.providerObjectId },
      });
      return { claim: null as ClaimedRefund | null };
    }
    return {
      claim: {
        providerOpId: claim.opId,
        idempotencyKey: claim.idempotencyKey,
        stripeChargeId: resolvedStripeChargeId,
      },
    };
  });

  if (!prepared.claim) return { providerOpId: null };

  await executeStripeRefund({
    claim: prepared.claim,
    amountCents: input.refundCents,
    metadata: { depositId: input.depositId },
    onSuccess: async (tx, refundId) => {
      await tx.deposit.update({
        where: { id: input.depositId },
        data: { stripeRefundId: refundId },
      });
    },
  });

  return { providerOpId: prepared.claim.providerOpId };
}

type RefundInput = {
  invoiceId: string;
  amountCents: number;
  reason: RefundReason;
  notes?: string;
  toCredit?: boolean;
};

/**
 * The local half of an invoice refund, inside the caller's transaction (the caller has checked who is acting).
 * Writes the Refund record and, for a Stripe-paid invoice, the durable provider operation. The Stripe call itself is
 * `runPreparedInvoiceRefund`, which must run after the transaction commits.
 */
export async function prepareInvoiceRefundInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  input: RefundInput,
): Promise<{ refundId: string; claim: ClaimedRefund | null }> {
  const identity = await tx.invoice.findUnique({
    where: { id: input.invoiceId },
    select: { customerId: true },
  });
  if (!identity) throw new Error("Couldn't find that invoice.");

  await lockCustomerLedger(tx, identity.customerId);
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      customerId: string;
      amountPaidCents: number;
    }>
  >`
    SELECT "id", "customerId", "amountPaidCents"
    FROM "Invoice"
    WHERE "id" = ${input.invoiceId}
    FOR UPDATE
  `;
  const invoice = rows[0];
  if (!invoice || invoice.customerId !== identity.customerId) {
    throw new Error("Couldn't find that invoice.");
  }

  const priorRefunds = await tx.refund.findMany({
    where: { invoiceId: invoice.id },
    select: { id: true, amountCents: true, stripeRefundId: true },
    orderBy: { createdAt: "asc" },
  });
  const alreadyRefundedCents = priorRefunds.reduce(
    (sum, refund) => sum + refund.amountCents,
    0,
  );
  const refundableCents = invoice.amountPaidCents - alreadyRefundedCents;
  if (input.amountCents > refundableCents) {
    throw new Error("Refund amount exceeds the invoice amount still eligible for refund.");
  }

  if (input.toCredit) {
    const refund = await tx.refund.create({
      data: {
        invoiceId: invoice.id,
        amountCents: input.amountCents,
        reason: input.reason,
        notes: input.notes?.trim() || null,
        authorizedByUserId: userId,
      },
      select: { id: true },
    });
    await tx.customerCredit.create({
      data: {
        customerId: invoice.customerId,
        amountCents: input.amountCents,
        remainingCents: input.amountCents,
        reason: `Invoice refund — ${input.reason.toLowerCase().replaceAll("_", " ")}`,
        notes: input.notes?.trim() || null,
        authorizedByUserId: userId,
        sourceType: "REFUND_TO_CREDIT",
        sourceId: refund.id,
        side: null,
      },
    });
    return { refundId: refund.id, claim: null as ClaimedRefund | null };
  }

  const stripeAllocations = await tx.payment.findMany({
    where: {
      invoiceId: invoice.id,
      status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] },
      receipt: {
        source: "STRIPE",
        stripeChargeId: { not: null },
      },
    },
    select: {
      amountCents: true,
      receipt: { select: { stripeChargeId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  let selectedStripeChargeId: string | null = null;
  if (stripeAllocations.length > 0) {
    const capacityByCharge = new Map<string, number>();
    for (const allocation of stripeAllocations) {
      const chargeId = allocation.receipt?.stripeChargeId;
      if (!chargeId) continue;
      capacityByCharge.set(
        chargeId,
        (capacityByCharge.get(chargeId) ?? 0) + allocation.amountCents,
      );
    }

    const priorIds = priorRefunds.map((refund) => refund.id);
    const creditBacked = priorIds.length
      ? await tx.customerCredit.findMany({
          where: {
            sourceType: "REFUND_TO_CREDIT",
            sourceId: { in: priorIds },
          },
          select: { sourceId: true },
        })
      : [];
    const creditRefundIds = new Set(
      creditBacked.map((credit) => credit.sourceId).filter((id): id is string => Boolean(id)),
    );
    const cashRefunds = priorRefunds.filter((refund) => !creditRefundIds.has(refund.id));

    const operations = cashRefunds.length
      ? await tx.providerOperation.findMany({
          where: {
            kind: "REFUND_CREATE",
            subjectType: "Refund",
            subjectId: { in: cashRefunds.map((refund) => refund.id) },
          },
          select: { subjectId: true, idempotencyKey: true },
        })
      : [];
    const operationByRefund = new Map(
      operations.map((operation) => [operation.subjectId, operation.idempotencyKey]),
    );
    const reservedByCharge = new Map<string, number>();
    const chargeIds = [...capacityByCharge.keys()];

    for (const refund of cashRefunds) {
      const key = operationByRefund.get(refund.id);
      const mappedCharge = key
        ? chargeFromInvoiceRefundProviderKey(refund.id, key)
        : null;
      if (mappedCharge) {
        reservedByCharge.set(
          mappedCharge,
          (reservedByCharge.get(mappedCharge) ?? 0) + refund.amountCents,
        );
        continue;
      }
      if (chargeIds.length === 1) {
        reservedByCharge.set(
          chargeIds[0]!,
          (reservedByCharge.get(chargeIds[0]!) ?? 0) + refund.amountCents,
        );
        continue;
      }
      throw new Error(
        "Earlier refunds on this multi-charge invoice do not identify their source charge. Reconcile them before issuing another automatic Stripe refund.",
      );
    }

    selectedStripeChargeId = chargeIds.find((chargeId) => {
      const capacity = capacityByCharge.get(chargeId) ?? 0;
      const reserved = reservedByCharge.get(chargeId) ?? 0;
      return capacity - reserved >= input.amountCents;
    }) ?? null;

    if (!selectedStripeChargeId) {
      throw new Error(
        "No single Stripe charge has enough unreserved refundable amount for this refund.",
      );
    }
  }

  const refund = await tx.refund.create({
    data: {
      invoiceId: invoice.id,
      amountCents: input.amountCents,
      reason: input.reason,
      notes: input.notes?.trim() || null,
      authorizedByUserId: userId,
    },
    select: { id: true },
  });

  if (!selectedStripeChargeId) {
    return { refundId: refund.id, claim: null as ClaimedRefund | null };
  }

  const claim = await claimProviderOperation(tx, {
    kind: "REFUND_CREATE",
    subjectType: "Refund",
    subjectId: refund.id,
    idempotencyKey: invoiceRefundProviderKey(refund.id, selectedStripeChargeId),
  });
  if (claim.done) {
    await tx.refund.update({
      where: { id: refund.id },
      data: { stripeRefundId: claim.providerObjectId },
    });
    return { refundId: refund.id, claim: null as ClaimedRefund | null };
  }

  return {
    refundId: refund.id,
    claim: {
      providerOpId: claim.opId,
      idempotencyKey: claim.idempotencyKey,
      stripeChargeId: selectedStripeChargeId,
    },
  };
}

/** The Stripe half of a prepared refund. Never throws for a provider problem: the outcome is recorded and retried. */
export async function runPreparedInvoiceRefund(prepared: {
  refundId: string;
  claim: ClaimedRefund;
  invoiceId: string;
  amountCents: number;
}): Promise<void> {
  await executeStripeRefund({
    claim: prepared.claim,
    amountCents: prepared.amountCents,
    metadata: { invoiceId: prepared.invoiceId, refundId: prepared.refundId },
    onSuccess: async (tx, stripeRefundId) => {
      await tx.refund.update({ where: { id: prepared.refundId }, data: { stripeRefundId } });
    },
  });
}

/**
 * Record an invoice refund decision. Stripe cash refunds reserve one concrete
 * source charge in the durable provider-operation key. Earlier refund
 * reservations are subtracted from that charge before another refund can use
 * it, so repeated partial refunds cannot overdraw one charge while ignoring
 * another.
 */
export async function issueInvoiceRefund(
  userId: string,
  input: RefundInput,
): Promise<{ refundId: string; providerOpId: string | null }> {
  positiveCents(input.amountCents, "Refund amount");

  const prepared = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    return prepareInvoiceRefundInTx(tx, userId, input);
  });

  if (!prepared.claim) {
    return { refundId: prepared.refundId, providerOpId: null };
  }

  await runPreparedInvoiceRefund({
    refundId: prepared.refundId,
    claim: prepared.claim,
    invoiceId: input.invoiceId,
    amountCents: input.amountCents,
  });

  return {
    refundId: prepared.refundId,
    providerOpId: prepared.claim.providerOpId,
  };
}

/**
 * Send a held payment back to the customer's card (owner decision IN-23). The
 * whole payment is refunded against the Stripe charge it came from. A refund
 * record is written against the closed invoice (so reports show it and the
 * Stripe "refunded" notification is recognized as already recorded), and the
 * held payment is marked refunded in the same transaction that claims the
 * provider operation; a Stripe failure is recovered by the billing
 * reconciliation pass like any other refund.
 */
export async function refundHeldPayment(
  userId: string,
  paymentId: string,
): Promise<{ refundId: string; providerOpId: string; outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN" }> {
  const prepared = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const identity = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { invoice: { select: { id: true, customerId: true } } },
    });
    if (!identity) throw new Error("Couldn't find that held payment.");
    await lockCustomerLedger(tx, identity.invoice.customerId);
    const rows = await tx.$queryRaw<
      Array<{ id: string; status: string; amountCents: number; receiptId: string | null }>
    >`SELECT "id", "status", "amountCents", "receiptId" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
    const payment = rows[0];
    if (!payment) throw new Error("Couldn't find that held payment.");
    if (payment.status !== HELD_PAYMENT_STATUS) throw new Error("This payment has already been dealt with.");
    const receipt = payment.receiptId
      ? await tx.receipt.findUnique({
          where: { id: payment.receiptId },
          select: { source: true, stripeChargeId: true },
        })
      : null;
    if (!receipt || receipt.source !== "STRIPE" || !receipt.stripeChargeId) {
      throw new Error("This payment didn't come through Stripe, so it can't be refunded to a card from here.");
    }
    const refund = await tx.refund.create({
      data: {
        invoiceId: identity.invoice.id,
        amountCents: payment.amountCents,
        reason: "OTHER",
        notes: "Held payment (arrived after the invoice was closed) sent back to the customer's card.",
        authorizedByUserId: userId,
      },
      select: { id: true },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: HELD_REFUNDED_STATUS, notes: "Held payment refunded to the customer's card." },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "billing.held_payment_refunded",
        entityType: "Payment",
        entityId: payment.id,
        newValue: { refundId: refund.id, amountCents: payment.amountCents },
      },
    });
    const claim = await claimProviderOperation(tx, {
      kind: "REFUND_CREATE",
      subjectType: "Refund",
      subjectId: refund.id,
      idempotencyKey: invoiceRefundProviderKey(refund.id, receipt.stripeChargeId),
    });
    return {
      refundId: refund.id,
      amountCents: payment.amountCents,
      invoiceId: identity.invoice.id,
      claim: claim.done
        ? null
        : { providerOpId: claim.opId, idempotencyKey: claim.idempotencyKey, stripeChargeId: receipt.stripeChargeId },
    };
  });

  if (!prepared.claim) return { refundId: prepared.refundId, providerOpId: "", outcome: "SUCCEEDED" };

  const outcome = await executeStripeRefund({
    claim: prepared.claim,
    amountCents: prepared.amountCents,
    metadata: { invoiceId: prepared.invoiceId, refundId: prepared.refundId },
    onSuccess: async (tx, stripeRefundId) => {
      await tx.refund.update({ where: { id: prepared.refundId }, data: { stripeRefundId } });
    },
  });
  return { refundId: prepared.refundId, providerOpId: prepared.claim.providerOpId, outcome };
}
