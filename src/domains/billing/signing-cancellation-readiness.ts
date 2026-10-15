import type { Prisma } from "@prisma/client";

/**
 * Call after the agreement lock. Share the obligation lock with collection and
 * settlement so cancellation cannot mistake an in-flight payment for no money.
 * This verifies cancellation evidence; it never creates or refunds a receipt.
 */
export async function getSigningCancellationPaymentInTx(
  tx: Prisma.TransactionClient,
  agreementId: string,
  customerId: string,
) {
  await tx.$queryRaw`SELECT "agreementId" FROM "AgreementSigningPayment"
    WHERE "agreementId" = ${agreementId} FOR UPDATE`;
  const obligation = await tx.agreementSigningPayment.findUnique({
    where: { agreementId },
    include: {
      receipt: { select: { id: true, customerId: true, amountCents: true } },
      attempts: {
        select: { status: true, method: true, amountCents: true, orderFingerprint: true },
      },
    },
  });
  if (!obligation) return null; // Legacy agreement without W-22 signing money.
  if (obligation.attempts.some(attempt =>
    attempt.method === "STRIPE_CHECKOUT" && ["PREPARED", "PENDING"].includes(attempt.status)
  )) {
    throw new Error("A signing card payment is still pending or unverified. Reconcile it before cancelling.");
  }
  if (obligation.status === "SETTLED" &&
      (!obligation.receipt || obligation.receipt.customerId !== customerId ||
        obligation.receipt.amountCents !== obligation.totalCents || !obligation.receiptId)) {
    throw new Error("The signed payment and receipt disagree. Finance reconciliation is required.");
  }
  if (obligation.status !== "SETTLED" && obligation.receiptId) {
    throw new Error("A receipt exists without a settled obligation. Finance reconciliation is required.");
  }
  const succeeded = obligation.attempts.filter(attempt => attempt.status === "SUCCEEDED");
  if (succeeded.length > 1 || succeeded.some(attempt =>
    obligation.status !== "SETTLED" || !obligation.receipt ||
    attempt.amountCents !== obligation.totalCents ||
    attempt.orderFingerprint !== obligation.orderFingerprint
  )) {
    throw new Error("A signing payment may have succeeded without a reconciled receipt. Reconcile it before cancelling.");
  }
  return obligation;
}
