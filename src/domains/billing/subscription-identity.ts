import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";

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
 * Recover a lost local subscription identity before the webhook enters its
 * serialized money-processing transaction. Stripe lookup intentionally happens
 * here, outside that transaction, so provider latency never extends the global
 * webhook advisory lock.
 *
 * Recovery is conservative: a missing id may be healed from Stripe metadata;
 * an existing different id is never overwritten. Conflicts are committed to
 * the audit log and then rejected so Stripe retries while reconciliation has a
 * durable record of what went wrong.
 */
export async function ensureSubscriptionIdentityForWebhook(event: Stripe.Event): Promise<void> {
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
