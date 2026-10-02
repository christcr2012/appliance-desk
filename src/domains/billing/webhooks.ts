import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { processStripeWebhookEvent as processStripeWebhookEventCore } from "./webhooks-core";

type SubscriptionIdentity = {
  subscriptionId: string;
  agreementIdFromEvent: string | null;
} | null;

function subscriptionIdentityFromEvent(event: Stripe.Event): SubscriptionIdentity {
  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    return {
      subscriptionId: subscription.id,
      agreementIdFromEvent: subscription.metadata?.agreementId ?? null,
    };
  }

  if (event.type !== "invoice.paid" && event.type !== "invoice.payment_failed") {
    return null;
  }

  const invoice = event.data.object as Stripe.Invoice;
  const subscription = invoice.parent?.subscription_details?.subscription;
  if (!subscription) return null;
  return {
    subscriptionId: typeof subscription === "string" ? subscription : subscription.id,
    agreementIdFromEvent: null,
  };
}

/**
 * Recover a lost local subscription identity before entering the webhook's
 * serialized money-processing transaction. Provider lookup is intentionally
 * outside that transaction so Stripe latency never extends the advisory lock.
 *
 * The heal is conservative: an empty local id may be filled from Stripe
 * metadata, but an existing different id is never overwritten. Conflicts are
 * committed to the audit log and then thrown so the webhook remains unprocessed
 * and can be reconciled/retried instead of silently attaching money to the
 * wrong agreement.
 */
async function ensureSubscriptionIdentity(event: Stripe.Event): Promise<void> {
  const identity = subscriptionIdentityFromEvent(event);
  if (!identity) return;

  const existing = await prisma.rentalAgreement.findUnique({
    where: { stripeSubscriptionId: identity.subscriptionId },
    select: { id: true },
  });
  if (existing) return;

  let agreementId = identity.agreementIdFromEvent;
  if (!agreementId) {
    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(identity.subscriptionId);
    agreementId = subscription.metadata?.agreementId ?? null;
  }
  if (!agreementId) return;

  const outcome = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; stripeSubscriptionId: string | null }>>`
      SELECT "id", "stripeSubscriptionId"
      FROM "RentalAgreement"
      WHERE "id" = ${agreementId}
      FOR UPDATE
    `;
    const target = rows[0];
    if (!target) return { kind: "missing" as const };

    if (target.stripeSubscriptionId === identity.subscriptionId) {
      return { kind: "linked" as const };
    }

    if (target.stripeSubscriptionId) {
      await tx.auditLog.create({
        data: {
          userId: null,
          action: "billing.subscription_id_conflict",
          entityType: "RentalAgreement",
          entityId: target.id,
          newValue: {
            stripeSubscriptionId: identity.subscriptionId,
            existingStripeSubscriptionId: target.stripeSubscriptionId,
            source: "stripe_metadata",
          },
        },
      });
      return {
        kind: "conflict" as const,
        detail: `agreement ${target.id} is already linked to ${target.stripeSubscriptionId}`,
      };
    }

    const linkedElsewhere = await tx.rentalAgreement.findUnique({
      where: { stripeSubscriptionId: identity.subscriptionId },
      select: { id: true },
    });
    if (linkedElsewhere && linkedElsewhere.id !== target.id) {
      await tx.auditLog.create({
        data: {
          userId: null,
          action: "billing.subscription_id_conflict",
          entityType: "RentalAgreement",
          entityId: target.id,
          newValue: {
            stripeSubscriptionId: identity.subscriptionId,
            linkedAgreementId: linkedElsewhere.id,
            source: "stripe_metadata",
          },
        },
      });
      return {
        kind: "conflict" as const,
        detail: `subscription ${identity.subscriptionId} is already linked to agreement ${linkedElsewhere.id}`,
      };
    }

    await tx.rentalAgreement.update({
      where: { id: target.id },
      data: { stripeSubscriptionId: identity.subscriptionId },
    });
    await tx.auditLog.create({
      data: {
        userId: null,
        action: "billing.subscription_id_healed",
        entityType: "RentalAgreement",
        entityId: target.id,
        newValue: {
          stripeSubscriptionId: identity.subscriptionId,
          source: "stripe_metadata",
        },
      },
    });
    return { kind: "healed" as const };
  });

  if (outcome.kind === "conflict") {
    throw new Error(`Stripe subscription identity conflict: ${outcome.detail}.`);
  }
}

/**
 * Public webhook entry point. Identity recovery happens first; the established
 * webhook core still owns event deduplication, the global advisory lock, and
 * all atomic money/lifecycle writes.
 */
export async function processStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  await ensureSubscriptionIdentity(event);
  await processStripeWebhookEventCore(event);
}
