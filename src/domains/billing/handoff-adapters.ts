import { prisma } from "@/lib/prisma";
import { pushLateDeliveryCreditToStripe } from "./pickup-billing-events";
import type { HandoffWorkOutcome } from "./handoff-outcome";

/**
 * Translate the late-delivery credit command's durable local/provider state
 * into the explicit contract consumed by JobBillingHandoff. A normal function
 * return is deliberately not treated as provider success.
 */
export async function pushLateDeliveryCreditForHandoff(
  creditId: string,
): Promise<HandoffWorkOutcome> {
  try {
    await pushLateDeliveryCreditToStripe(creditId);
  } catch (error) {
    return {
      state: "RETRY",
      detail: error instanceof Error ? error.message : "Late-delivery credit failed before its provider outcome was recorded.",
    };
  }

  const credit = await prisma.customerCredit.findUnique({
    where: { id: creditId },
    select: {
      amountCents: true,
      remainingCents: true,
      appliedViaStripeAt: true,
      customer: { select: { stripeCustomerId: true } },
    },
  });
  if (!credit) return { state: "BLOCKED", detail: "The late-delivery credit no longer exists." };
  if (credit.appliedViaStripeAt) return { state: "DONE" };
  if (credit.remainingCents < credit.amountCents) {
    return { state: "DONE", detail: "The credit was already consumed locally and must not also be sent to Stripe." };
  }
  if (!credit.customer.stripeCustomerId) {
    return { state: "BLOCKED", detail: "The customer has no Stripe customer record for this balance credit." };
  }

  const operation = await prisma.providerOperation.findUnique({
    where: { idempotencyKey: `late-delivery-credit-${creditId}` },
    select: { status: true, lastError: true },
  });
  if (!operation) {
    return { state: "RETRY", detail: "The Stripe balance-credit operation has not been claimed yet." };
  }
  switch (operation.status) {
    case "FAILED":
      return { state: "RETRY", detail: operation.lastError ?? "Stripe rejected the balance-credit attempt." };
    case "PENDING":
      return { state: "RETRY", detail: "The Stripe balance-credit attempt is still in progress." };
    case "UNKNOWN":
    case "DRIFT":
      return { state: "UNKNOWN", detail: operation.lastError ?? "The Stripe balance-credit outcome needs reconciliation." };
    case "SUPERSEDED":
      return { state: "UNKNOWN", detail: "This provider operation was superseded by a newer durable decision." };
    case "SUCCEEDED":
      return {
        state: "UNKNOWN",
        detail: "Stripe reports the balance credit succeeded, but the local credit is not finalized; reconciliation is required.",
      };
  }
}
