import { NextResponse } from "next/server";
import { getStripeClient } from "@/lib/stripe";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";

// Stripe webhook endpoint — see docs/ARCHITECTURE.md's "Payments (Stripe)"
// section for how to register this URL in the Stripe dashboard (a manual,
// one-time step only Chris can do, since it needs the real deployed URL).
//
// Signature verification (not a login/role check — Stripe itself is the
// caller here) is what proves a request genuinely came from Stripe and
// wasn't forged; without STRIPE_WEBHOOK_SECRET set, every request is
// rejected rather than trusted blindly, since accepting unverified
// "Stripe" requests would let anyone mark any invoice paid.
export async function POST(request: Request): Promise<Response> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set — refusing to process any webhook.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  // Must be the raw, unparsed body — Stripe's signature is computed over
  // the exact bytes it sent, so request.json() (which re-serializes)
  // would break verification.
  const rawBody = await request.text();

  const stripe = getStripeClient();
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    await processStripeWebhookEvent(event);
  } catch (error) {
    // Returning a 500 tells Stripe to retry this same event later — the
    // WebhookEvent idempotency check (src/domains/billing/webhooks.ts)
    // makes a retry after a PARTIAL failure safe to reprocess, since
    // nothing was recorded as handled until the whole thing succeeded.
    console.error(`Error processing Stripe webhook event ${event.id} (${event.type}):`, error);
    return NextResponse.json({ error: "Internal error processing event" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
