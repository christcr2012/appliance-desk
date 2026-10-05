import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { resolveDepositRefundRail } from "./deposit-provenance";
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

type ClaimedDepositRefund = {
  providerOpId: string;
  idempotencyKey: string;
  stripeChargeId: string;
};

async function executeStripeDepositRefund(input: {
  depositId: string;
  claim: ClaimedDepositRefund;
  amountCents: number;
}): Promise<void> {
  const stripe = getStripeClient();
  const result = await runProviderCall(() =>
    stripe.refunds.create(
      {
        charge: input.claim.stripeChargeId,
        amount: input.amountCents,
        metadata: { depositId: input.depositId },
      },
      { idempotencyKey: input.claim.idempotencyKey },
    ),
  );

  await prisma.$transaction(async (tx) => {
    if (result.ok) {
      await tx.deposit.update({
        where: { id: input.depositId },
        data: { stripeRefundId: result.value.id },
      });
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
 * Owner/admin deposit-refund decision. Authorization is checked before legacy
 * provenance recovery because recovery can persist durable financial facts.
 * The funding rail is then resolved before the deposit row is locked, so
 * provider reads never happen under a money row lock. The actor is checked
 * again inside the locked decision transaction before any refund mutation.
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

  await prisma.$transaction((tx) =>
    assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]),
  );
  const rail = await resolveDepositRefundRail(input.depositId);

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
        sourceReceiptId: string | null;
      }>
    >`
      SELECT
        "id", "agreementId", "amountCents", "refundable", "refundedAt",
        "stripeRefundId", "sourceReceiptId"
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
    if (!deposit.sourceReceiptId || deposit.sourceReceiptId !== rail.receiptId) {
      throw new Error(
        "This deposit's payment source changed while the refund was being prepared. Refresh and try again.",
      );
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
          returnMethod: rail.kind === "STRIPE" ? "stripe" : "manual",
          sourceReceiptId: rail.receiptId,
        },
      },
    });

    if (rail.kind === "MANUAL") {
      return { claim: null as ClaimedDepositRefund | null };
    }

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
      return { claim: null as ClaimedDepositRefund | null };
    }

    return {
      claim: {
        providerOpId: claim.opId,
        idempotencyKey: claim.idempotencyKey,
        stripeChargeId: rail.stripeChargeId,
      },
    };
  });

  if (!prepared.claim) return { providerOpId: null };

  await executeStripeDepositRefund({
    depositId: input.depositId,
    claim: prepared.claim,
    amountCents: input.refundCents,
  });
  return { providerOpId: prepared.claim.providerOpId };
}
