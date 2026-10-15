import { signedReserveAmount } from "./signing-reserve-liability";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getReviewedSigningPaymentInTx } from "./signing-payment-readiness";
import type { ManualPaymentMethod } from "./manual-payments";

const METHODS = ["cash", "check", "bank_transfer", "other"];
export type ManualSigningPaymentInput = {
  agreementId: string; attemptId: string; actingUserId: string;
  method: ManualPaymentMethod; reference: string;
  receivedOn: string; confirmedReceived: boolean;
};
export type RecordedManualSigningPayment = {
  receiptId: string; amountCents: number; method: ManualPaymentMethod;
  receivedOn: Date; replayed: boolean;
};
function validate(input: ManualSigningPaymentInput) {
  if (!input.confirmedReceived) throw new Error("Confirm the full payment was actually received.");
  if (!METHODS.includes(input.method)) throw new Error("Choose a supported payment method.");
  if (!input.agreementId || !input.attemptId || !input.actingUserId)
    throw new Error("Signing payment, attempt, or owner is missing.");
  const reference = input.reference.trim();
  if (!reference || reference.length > 120 || /[\u0000-\u001f\u007f]/.test(reference))
    throw new Error("Enter a valid payment reference (1–120 characters).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn)) throw new Error("Enter a valid payment date.");
  const receivedOn = new Date(input.receivedOn + "T12:00:00.000Z");
  if (!Number.isFinite(receivedOn.getTime()) ||
      receivedOn.toISOString().slice(0, 10) !== input.receivedOn)
    throw new Error("Enter a valid payment date.");
  return { receivedOn, reference, notes: "W-22 exact signed manual payment; Ref: " + reference };
}

/** Explicit money-in for exactly one signed agreement; no invoice allocations. */
export async function recordManualSigningPayment(input: ManualSigningPaymentInput):
  Promise<RecordedManualSigningPayment> {
  const { receivedOn, reference, notes } = validate(input);
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, input.actingUserId, ["OWNER", "ADMIN"]);
    // Match cancellation and review: agreement -> obligation -> review -> receipt/reserve.
    await tx.$queryRaw`SELECT "id" FROM "RentalAgreement" WHERE "id" = ${input.agreementId} FOR UPDATE`;
    const locked = await tx.$queryRaw<Array<{ agreementId: string }>>`
      SELECT "agreementId" FROM "AgreementSigningPayment"
      WHERE "agreementId" = ${input.agreementId} FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error("Signed payment obligation is missing.");
    const obligation = await tx.agreementSigningPayment.findUnique({
      where: { agreementId: input.agreementId },
      include: { agreement: { select: { customerId: true, depositCents: true } }, receipt: true },
    });
    const attempt = await tx.signingPaymentAttempt.findUnique({
      where: { id: input.attemptId },
    });
    if (!obligation || !attempt ||
        attempt.agreementId !== input.agreementId || attempt.method !== "MANUAL" ||
        attempt.orderFingerprint !== obligation.orderFingerprint ||
        attempt.amountCents !== obligation.totalCents ||
        attempt.providerObjectId || attempt.stripePaymentIntentId ||
        obligation.totalCents <= 0)
      throw new Error("Manual attempt differs from signed obligation.");
    const reserveAmount = signedReserveAmount({ ...obligation, agreementDepositCents: obligation.agreement.depositCents });
    if (obligation.status === "SETTLED") {
      const receipt = obligation.receipt;
      if (!receipt || attempt.status !== "SUCCEEDED" || receipt.source !== "MANUAL" ||
          receipt.id !== obligation.receiptId || receipt.amountCents !== obligation.totalCents ||
          receipt.recordedByUserId !== input.actingUserId ||
          receipt.method !== input.method || receipt.notes !== notes ||
          receipt.receivedOn.getTime() !== receivedOn.getTime())
        throw new Error("Signing payment already settled; investigate before recording again.");
      const recordedReserve = await tx.deposit.findMany({
        where: { agreementId: input.agreementId, sourceReceiptId: receipt.id },
        select: { amountCents: true },
      });
      if (reserveAmount > 0
        ? recordedReserve.length !== 1 || recordedReserve[0].amountCents !== reserveAmount
        : recordedReserve.length !== 0)
        throw new Error("Collected reserve has not reconciled with the original receipt.");
      return { receiptId: receipt.id, amountCents: receipt.amountCents,
        method: input.method, receivedOn: receipt.receivedOn, replayed: true };
    }
    if (obligation.status !== "AWAITING_PAYMENT" || obligation.receiptId ||
        attempt.status !== "PREPARED")
      throw new Error("Signing collection is no longer eligible for manual settlement.");
    const otherActive = await tx.signingPaymentAttempt.count({
      where: { agreementId: input.agreementId, id: { not: attempt.id },
        status: { in: ["PREPARED", "PENDING"] } },
    });
    if (otherActive) throw new Error("Another signing payment is pending.");
    const reviewed = await getReviewedSigningPaymentInTx(tx, input.agreementId);
    if (reviewed.customerId !== obligation.agreement.customerId ||
        reviewed.signedAt.getTime() !== obligation.signedAt.getTime() ||
        reviewed.plan.orderFingerprint !== obligation.orderFingerprint ||
        reviewed.plan.evidenceVersion !== obligation.evidenceVersion ||
        reviewed.plan.allInCents !== obligation.totalCents)
      throw new Error("Frozen signed amount does not match; no payment recorded.");
    const receipt = await tx.receipt.create({
      data: { customerId: obligation.agreement.customerId, source: "MANUAL",
        amountCents: obligation.totalCents, method: input.method,
        receivedOn, recordedByUserId: input.actingUserId, notes },
    });
    await tx.signingPaymentAttempt.update({
      where: { id: attempt.id }, data: { status: "SUCCEEDED", failureCode: null },
    });
    await tx.agreementSigningPayment.update({
      where: { agreementId: input.agreementId },
      data: { status: "SETTLED", receiptId: receipt.id, settledAt: receivedOn },
    });
    if (reserveAmount > 0)
      await tx.deposit.create({ data: {
        agreementId: input.agreementId, sourceReceiptId: receipt.id,
        amountCents: reserveAmount, refundable: true,
      } });
    if (obligation.downPaymentCents > 0)
      await tx.signingDownPaymentCredit.create({
        data: { agreementId: input.agreementId, receiptId: receipt.id,
          orderFingerprint: obligation.orderFingerprint, amountCents: obligation.downPaymentCents },
      });
    await tx.auditLog.create({
      data: { userId: input.actingUserId, action: "billing.signing_manual_payment",
        entityType: "RentalAgreement", entityId: input.agreementId,
        newValue: { receiptId: receipt.id, attemptId: attempt.id,
          amountCents: obligation.totalCents, method: input.method,
          reference, receivedOn: input.receivedOn,
          orderFingerprint: obligation.orderFingerprint } },
    });
    return { receiptId: receipt.id, amountCents: obligation.totalCents,
      method: input.method, receivedOn, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
