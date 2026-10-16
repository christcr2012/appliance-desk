import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { getReviewedSigningPayment } from "./signing-payment-readiness";
import { prepareSigningPaymentAttempt } from "./signing-payment-attempts";

/**
 * A TEST-only hosted Checkout boundary. An open Checkout is not a receipt.
 * The separate authenticated webhook must verify payment_intent settlement,
 * reconcile exact frozen cents, and apply credits before paid-state advances.
 * IN-79 and owner permission for LIVE remain unapproved.
 */
export type SigningCheckoutLink = {
  attemptId: string;
  agreementId: string;
  sessionId: string;
  checkoutUrl: string | null;
  status: "AWAITING_CUSTOMER" | "AWAITING_RECONCILIATION";
};

function assertTestCheckoutAllowed() {
  if (process.env.W22_SIGNING_TEST_CHECKOUT_ENABLED !== "true" ||
      process.env.VERCEL_ENV === "production" ||
      !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    throw new Error("W-22 signing checkout is not authorized (IN-79/owner LIVE gate).");
  }
}

function safeReturnOrigin(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const origin = new URL(appUrl);
  if (origin.username || origin.password || origin.search || origin.hash ||
      !["https:", "http:"].includes(origin.protocol) ||
      (origin.protocol === "http:" &&
        !["localhost", "127.0.0.1"].includes(origin.hostname))) {
    throw new Error("Invalid configured signing checkout return origin.");
  }
  return origin.origin;
}

function requireVerifiedCheckoutSession(
  session: Stripe.Checkout.Session,
  agreementId: string,
  attemptId: string,
  fingerprint: string,
  cents: number,
): void {
  if (session.mode !== "payment" || session.client_reference_id !== agreementId ||
      session.amount_total !== cents || session.currency?.toLowerCase() !== "usd" ||
      session.metadata?.agreementId !== agreementId ||
      session.metadata?.attemptId !== attemptId ||
      session.metadata?.orderFingerprint !== fingerprint ||
      !session.id.startsWith("cs_")) {
    throw new Error("Stripe session disagrees with accepted signing charges; reconcile manually.");
  }
}

export async function createSigningTestCheckout(
  agreementId: string,
): Promise<SigningCheckoutLink> {
  // Guard FIRST, before reservation or any provider call.
  assertTestCheckoutAllowed();
  const attempt = await prepareSigningPaymentAttempt(agreementId, "STRIPE_CHECKOUT");
  const reviewed = await getReviewedSigningPayment(agreementId);
  if (attempt.amountCents !== reviewed.plan.allInCents ||
      attempt.amountCents <= 0 ||
      attempt.status === "SUCCEEDED" ||
      reviewed.plan.orderFingerprint !==
        (await prisma.signingPaymentAttempt.findUniqueOrThrow({
          where: { id: attempt.id }, select: { orderFingerprint: true },
        })).orderFingerprint) {
    throw new Error("Payment attempt differs from signed frozen amount.");
  }
  const stripe = getStripeClient();
  const attemptRow = await prisma.signingPaymentAttempt.findUniqueOrThrow({
    where: { id: attempt.id },
    select: { providerObjectId: true, createdAt: true, status: true },
  });
  if (!["PREPARED", "PENDING"].includes(attemptRow.status)) {
    throw new Error("Signing attempt cannot be retried automatically.");
  }
  let session: Stripe.Checkout.Session;
  if (attemptRow.providerObjectId) {
    session = await stripe.checkout.sessions.retrieve(attemptRow.providerObjectId);
  } else {
    // Stripe's idempotency cache is time-bounded; never replay an unknown
    // outcome after a long outage when the original may have been charged.
    if (Date.now() - attemptRow.createdAt.getTime() > 6 * 60 * 60 * 1000) {
      throw new Error("Unknown old checkout attempt requires owner reconciliation.");
    }
    // Only a one-property, owner-authorized customer-completion quote returns
    // to its own no-login status page. A provider redirect is never paid proof.
    const source = await prisma.rentalAgreement.findUnique({
      where:{id:agreementId},
      select:{sourceEstimate:{select:{id:true,customerAutoFinishEnabled:true}}},
    });
    const returnPath=source?.sourceEstimate?.customerAutoFinishEnabled
      ? "/estimate/"+source.sourceEstimate.id
      : "/account";
    const existingCustomer=await prisma.rentalAgreement.findUniqueOrThrow({
      where:{id:agreementId},
      select:{customer:{select:{stripeCustomerId:true}}},
    });
    const w24Setup=!!source?.sourceEstimate?.customerAutoFinishEnabled;
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      payment_method_types: ["card"],
      ...(w24Setup?(existingCustomer.customer.stripeCustomerId
        ? {customer:existingCustomer.customer.stripeCustomerId}
        : {customer_creation:"always" as const}):{}),
      client_reference_id: agreementId,
      line_items: reviewed.plan.items.map(item => ({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: item.amountCents,
          product_data: { name: item.description, metadata: { kind: item.kind } },
        },
      })),
      success_url: safeReturnOrigin() + returnPath + "?signingPayment=processing",
      cancel_url: safeReturnOrigin() + returnPath + "?signingPayment=cancelled",
      metadata: {
        agreementId,
        attemptId: attempt.id,
        orderFingerprint: reviewed.plan.orderFingerprint,
        evidenceVersion: String(reviewed.plan.evidenceVersion),
        ...(w24Setup?{w24SavedMethod:"1"}:{}),
      },
      payment_intent_data: {
        ...(w24Setup?{setup_future_usage:"off_session" as const}:{}),
        metadata: {
          agreementId,
          attemptId: attempt.id,
          orderFingerprint: reviewed.plan.orderFingerprint,
        },
      },
    };
    session = await stripe.checkout.sessions.create(params, { idempotencyKey: attempt.requestKey });
  }
  requireVerifiedCheckoutSession(session, agreementId, attempt.id,
    reviewed.plan.orderFingerprint, attempt.amountCents);
  if (attemptRow.providerObjectId && attemptRow.providerObjectId !== session.id) {
    throw new Error("Provider changed the identity of an active checkout session.");
  }
  const wrote = await prisma.signingPaymentAttempt.updateMany({
    where: {
      id: attempt.id,
      status: { in: ["PREPARED", "PENDING"] },
      OR: [{ providerObjectId: null }, { providerObjectId: session.id }],
    },
    data: { providerObjectId: session.id, status: "PENDING" },
  });
  if (wrote.count !== 1) {
    throw new Error("Checkout state changed during provider call; reconcile manually.");
  }
  return {
    attemptId: attempt.id,
    agreementId,
    sessionId: session.id,
    checkoutUrl: session.status === "open" && session.payment_status !== "paid"
      ? session.url : null,
    status: session.status === "open" && session.payment_status !== "paid"
      ? "AWAITING_CUSTOMER" : "AWAITING_RECONCILIATION",
  };
}
