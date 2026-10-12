import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { idOf, type WebhookEvidence } from "./webhook-evidence";

/**
 * Handle only W-22-tagged sessions, after Stripe webhook signature validation.
 * Live settlement is NOT approved; never silently accept LIVE money.
 *
 * This executes inside the existing webhook's locked DB transaction, with
 * provider evidence collected before the lock. A redirect or Checkout
 * completion is not proof of settlement.
 */
export async function processSigningCheckoutEvent(
  tx: Prisma.TransactionClient,
  evidence: WebhookEvidence,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  // Owner has authorized TEST-only proof, never production bookkeeping here.
  if (process.env.VERCEL_ENV === "production" &&
      (session.metadata?.attemptId || session.metadata?.orderFingerprint)) {
    throw new Error("W-22 signing TEST settlement is disabled in production.");
  }
  const metadata = session.metadata ?? {};
  if (!metadata.attemptId && !metadata.orderFingerprint) return false;
  if (!metadata.attemptId || !metadata.orderFingerprint || !metadata.agreementId ||
      event.livemode !== false || session.livemode !== false ||
      session.mode !== "payment" || session.currency?.toLowerCase() !== "usd" ||
      session.client_reference_id !== metadata.agreementId ||
      !session.id.startsWith("cs_test_")) {
    throw new Error("W-22 signing webhook has invalid or unapproved provider evidence.");
  }
  const agreementId = metadata.agreementId;
  await tx.$queryRaw`
    SELECT "agreementId" FROM "AgreementSigningPayment"
    WHERE "agreementId" = ${agreementId} FOR UPDATE
  `;
  const obligation = await tx.agreementSigningPayment.findUnique({
    where: { agreementId },
    include: { agreement: { select: { customerId: true } } },
  });
  const attempt = await tx.signingPaymentAttempt.findUnique({
    where: { id: metadata.attemptId },
  });
  const signature = await tx.signatureRecord.findUnique({
    where: { agreementId },
    select: {
      signedAt: true, signingOrderFingerprint: true,
      signingEvidenceVersion: true, signingAllInCents: true,
    },
  });
  if (!obligation || !attempt || !signature?.signedAt ||
      attempt.agreementId !== agreementId ||
      attempt.method !== "STRIPE_CHECKOUT" ||
      attempt.orderFingerprint !== obligation.orderFingerprint ||
      obligation.orderFingerprint !== metadata.orderFingerprint ||
      signature.signingOrderFingerprint !== obligation.orderFingerprint ||
      signature.signingEvidenceVersion !== obligation.evidenceVersion ||
      signature.signingAllInCents !== obligation.totalCents ||
      attempt.amountCents !== obligation.totalCents ||
      session.amount_total !== obligation.totalCents ||
      obligation.totalCents <= 0 ||
      (attempt.providerObjectId && attempt.providerObjectId !== session.id)) {
    throw new Error("W-22 settlement does not match accepted signed obligation.");
  }

  if (event.type === "checkout.session.async_payment_failed") {
    if (obligation.status !== "SETTLED" && attempt.status !== "SUCCEEDED") {
      await tx.signingPaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: "FAILED", failureCode: "STRIPE_ASYNC_PAYMENT_FAILED",
          providerObjectId: session.id },
      });
    }
    return true;
  }
  if (event.type !== "checkout.session.completed" &&
      event.type !== "checkout.session.async_payment_succeeded") {
    throw new Error("Unsupported signing payment event.");
  }
  if (session.payment_status !== "paid") {
    // Stripe checkout completed, but the provider has not settled the funds.
    if (attempt.status === "PREPARED") {
      await tx.signingPaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: "PENDING", providerObjectId: session.id },
      });
    }
    return true;
  }
  const intentId = idOf(session.payment_intent);
  if (!intentId || !intentId.startsWith("pi_")) {
    throw new Error("W-22 paid Checkout is missing a provider payment intent.");
  }
  const intent = evidence.paymentIntentWithMethod(intentId);
  const chargeId = idOf(intent.latest_charge);
  const details = evidence.paymentDetails(intentId);
  if (intent.livemode !== false || intent.status !== "succeeded" ||
      intent.id !== intentId || intent.amount !== obligation.totalCents ||
      intent.amount_received !== obligation.totalCents ||
      intent.currency?.toLowerCase() !== "usd" ||
      intent.metadata?.agreementId !== agreementId ||
      intent.metadata?.attemptId !== attempt.id ||
      intent.metadata?.orderFingerprint !== obligation.orderFingerprint ||
      !chargeId || chargeId !== details.stripeChargeId ||
      !chargeId.startsWith("ch_") ||
      Number.isNaN(details.receivedOn.getTime())) {
    throw new Error("W-22 Checkout is not a verified exact-cents settled charge.");
  }

  if (obligation.status === "SETTLED") {
    if (!obligation.receiptId || attempt.stripePaymentIntentId !== intentId ||
        attempt.status !== "SUCCEEDED") {
      throw new Error("Conflicting second signing payment requires owner reconciliation.");
    }
    return true; // Replay, including a distinct Stripe event ID.
  }
  if (obligation.status !== "AWAITING_PAYMENT" || obligation.receiptId ||
      !["PREPARED", "PENDING"].includes(attempt.status)) {
    throw new Error("W-22 payment is not in an eligible settlement state.");
  }

  const receipt = await tx.receipt.create({
    data: {
      customerId: obligation.agreement.customerId,
      source: "STRIPE",
      amountCents: obligation.totalCents,
      method: details.method ?? "card",
      stripeChargeId: chargeId,
      receivedOn: details.receivedOn,
      notes: "W-22 frozen signing payment; first-invoice down-payment credit pending",
    },
  });
  await tx.signingPaymentAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "SUCCEEDED", failureCode: null,
      providerObjectId: session.id,
      stripePaymentIntentId: intentId,
    },
  });
  await tx.agreementSigningPayment.update({
    where: { agreementId },
    data: { status: "SETTLED", receiptId: receipt.id, settledAt: details.receivedOn },
  });
  return true;
}
