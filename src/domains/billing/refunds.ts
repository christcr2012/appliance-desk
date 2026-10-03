import type { Prisma, RefundReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { lockCustomerLedger } from "./ledger";
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

type ClaimedRefund = {
  providerOpId: string;
  idempotencyKey: string;
  stripeChargeId: string;
};

async function executeStripeRefund(input: {
  claim: ClaimedRefund;
  amountCents: number;
  metadata: Record<string, string>;
  onSuccess: (tx: Prisma.TransactionClient, refundId: string) => Promise<void>;
}): Promise<void> {
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
}

/**
 * Record an owner/admin deposit-refund decision under a row lock, then perform
 * any Stripe write only after the local decision commits. `disputeNotes` is
 * preserved in AuditLog because the approved Batch-B schema did not add a
 * dedicated Deposit column for it. Likewise, Deposit has no version column;
 * callers must omit expectedVersion until a later approved schema adds one.
 */
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

    const stripePayment = await tx.payment.findFirst({
      where: {
        status: "succeeded",
        invoice: {
          agreementId: deposit.agreementId,
          lineItems: { some: { kind: "DEPOSIT" } },
        },
        receipt: {
          source: "STRIPE",
          stripeChargeId: { not: null },
        },
      },
      select: {
        receipt: { select: { stripeChargeId: true } },
      },
      orderBy: { createdAt: "asc" },
    });

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
          returnMethod: stripePayment?.receipt?.stripeChargeId ? "stripe" : "manual",
        },
      },
    });

    const stripeChargeId = stripePayment?.receipt?.stripeChargeId ?? null;
    if (!stripeChargeId) return { claim: null as ClaimedRefund | null };

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
        stripeChargeId,
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

/**
 * Record an invoice refund decision. Local-credit refunds mint exactly one
 * CustomerCredit and never call Stripe. Cash/check/manual receipts require the
 * owner to return the money outside the app; Stripe receipts use one durable
 * REFUND_CREATE operation after the local transaction commits.
 */
export async function issueInvoiceRefund(
  userId: string,
  input: {
    invoiceId: string;
    amountCents: number;
    reason: RefundReason;
    notes?: string;
    toCredit?: boolean;
  },
): Promise<{ refundId: string; providerOpId: string | null }> {
  positiveCents(input.amountCents, "Refund amount");

  const prepared = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);

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

    const prior = await tx.refund.aggregate({
      where: { invoiceId: invoice.id },
      _sum: { amountCents: true },
    });
    const refundableCents = invoice.amountPaidCents - (prior._sum.amountCents ?? 0);
    if (input.amountCents > refundableCents) {
      throw new Error("Refund amount exceeds the invoice amount still eligible for refund.");
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

    if (input.toCredit) {
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
        status: "succeeded",
        receipt: {
          source: "STRIPE",
          stripeChargeId: { not: null },
        },
      },
      select: {
        amountCents: true,
        receipt: { select: { stripeChargeId: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    if (stripeAllocations.length === 0) {
      return { refundId: refund.id, claim: null as ClaimedRefund | null };
    }

    const source = stripeAllocations.find(
      (allocation) =>
        allocation.receipt?.stripeChargeId && allocation.amountCents >= input.amountCents,
    );
    const stripeChargeId = source?.receipt?.stripeChargeId ?? null;
    if (!stripeChargeId) {
      throw new Error(
        "This refund spans multiple Stripe charges; automatic multi-charge refunds are not defined in Batch B.",
      );
    }

    const claim = await claimProviderOperation(tx, {
      kind: "REFUND_CREATE",
      subjectType: "Refund",
      subjectId: refund.id,
      idempotencyKey: `invoice-refund-${refund.id}`,
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
        stripeChargeId,
      },
    };
  });

  if (!prepared.claim) {
    return { refundId: prepared.refundId, providerOpId: null };
  }

  await executeStripeRefund({
    claim: prepared.claim,
    amountCents: input.amountCents,
    metadata: { invoiceId: input.invoiceId, refundId: prepared.refundId },
    onSuccess: async (tx, stripeRefundId) => {
      await tx.refund.update({
        where: { id: prepared.refundId },
        data: { stripeRefundId },
      });
    },
  });

  return {
    refundId: prepared.refundId,
    providerOpId: prepared.claim.providerOpId,
  };
}
