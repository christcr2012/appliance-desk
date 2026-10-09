import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { claimProviderOperation, completeProviderOperation, RetryLater, runProviderCall } from "./provider-ops";
import { stripeKeyForAttempt } from "./subscription-term";
import type Stripe from "stripe";

/**
 * Lowering (or removing) one rental line on the customer's Stripe subscription after an item on it was
 * permanently cancelled (Batch C section 8). Same durable provider-operation pattern as the end-date changes in
 * `subscription-term.ts`: the claim is written in the same database transaction as the local decision, Stripe is
 * called after it commits, and the answer is recorded as SUCCEEDED, FAILED, UNKNOWN or DRIFT. The target amount is
 * always read from the line's current local price, so a retry can never apply stale data.
 */

export const lineReduceKey = (pendingDeliveryId: string) => `subscription-line-reduce-${pendingDeliveryId}`;

export function parseLineReduceKey(key: string): string | null {
  const match = /^subscription-line-reduce-(.+)$/.exec(key);
  return match ? match[1]! : null;
}

export type LineReduceDesired =
  | { moot: true; subscriptionId: string }
  | { moot: false; subscriptionId: string; rentalLineId: string; amountCents: number; remove: boolean };

/** What Stripe's item for this line should look like right now, or null when nothing applies (no subscription yet). */
export async function desiredLineReduction(pendingDeliveryId: string): Promise<LineReduceDesired | null> {
  const pending = await prisma.pendingDelivery.findUnique({
    where: { id: pendingDeliveryId },
    select: {
      rentalLineId: true,
      agreement: { select: { status: true, stripeSubscriptionId: true } },
    },
  });
  if (!pending?.agreement.stripeSubscriptionId) return null;
  // An ended or cancelled agreement has its whole subscription cancelled by the close path.
  if (pending.agreement.status !== "ACTIVE") return { moot: true, subscriptionId: pending.agreement.stripeSubscriptionId };
  const line = await prisma.rentalLine.findUnique({
    where: { id: pending.rentalLineId },
    select: { monthlyPriceCents: true, assignments: { where: { unassignedAt: null }, select: { id: true } } },
  });
  if (!line) return null;
  return {
    moot: false,
    subscriptionId: pending.agreement.stripeSubscriptionId,
    rentalLineId: pending.rentalLineId,
    amountCents: line.monthlyPriceCents,
    remove: line.assignments.length === 0,
  };
}

type SubscriptionItem = Stripe.SubscriptionItem & { price: Stripe.Price & { product: Stripe.Product } };

/** Find the subscription item that was built for this rental line (the product carries the line id). */
export function findLineItem(subscription: Stripe.Subscription, rentalLineId: string): SubscriptionItem | null {
  for (const item of subscription.items.data) {
    const product = item.price.product;
    if (typeof product === "object" && product && !("deleted" in product && product.deleted) && product.metadata?.rentalLineId === rentalLineId) {
      return item as SubscriptionItem;
    }
  }
  return null;
}

export type LineReduceOutcome =
  | { kind: "matches" }
  | { kind: "no_item" }
  | { kind: "updated" }
  | { kind: "failed"; outcome: "FAILED" | "UNKNOWN"; error: unknown };

export type LineReadState =
  | { kind: "matches" }
  | { kind: "no_item" }
  | { kind: "needs_update"; item: SubscriptionItem }
  | { kind: "failed"; outcome: "FAILED" | "UNKNOWN"; error: unknown };

/** Read Stripe and say whether this line's item already has the wanted amount (or is already gone). Sends nothing. */
export async function readLineState(stripe: Stripe, desired: Extract<LineReduceDesired, { moot: false }>): Promise<LineReadState> {
  const read = await runProviderCall(() => stripe.subscriptions.retrieve(desired.subscriptionId, { expand: ["items.data.price.product"] }));
  if (!read.ok) return { kind: "failed", outcome: read.outcome, error: read.error };
  const item = findLineItem(read.value, desired.rentalLineId);
  if (!item) return desired.remove ? { kind: "matches" } : { kind: "no_item" };
  if (!desired.remove && item.price.unit_amount === desired.amountCents) return { kind: "matches" };
  return { kind: "needs_update", item };
}

/** Send the change that makes the item match. `key` is the idempotency key for the update call. */
export async function sendLineUpdate(
  stripe: Stripe,
  desired: Extract<LineReduceDesired, { moot: false }>,
  item: SubscriptionItem,
  key: string,
): Promise<LineReduceOutcome> {
  const sent = await runProviderCall(() =>
    stripe.subscriptions.update(
      desired.subscriptionId,
      {
        proration_behavior: "none",
        items: [
          desired.remove
            ? { id: item.id, deleted: true }
            : {
                id: item.id,
                price_data: { currency: "usd", product: item.price.product.id, unit_amount: desired.amountCents, recurring: { interval: "month" } },
                tax_rates: (item.tax_rates ?? []).map((rate) => rate.id),
              },
        ],
      },
      { idempotencyKey: key },
    ),
  );
  return sent.ok ? { kind: "updated" } : { kind: "failed", outcome: sent.outcome, error: sent.error };
}

/** Read Stripe, then change the item only if it does not already match. */
export async function applyLineReduction(
  stripe: Stripe,
  desired: Extract<LineReduceDesired, { moot: false }>,
  key: string,
): Promise<LineReduceOutcome> {
  const state = await readLineState(stripe, desired);
  if (state.kind === "needs_update") return sendLineUpdate(stripe, desired, state.item, key);
  return state;
}

const NO_ITEM_NOTE = "No Stripe subscription item is marked with this rental line, so it was not changed. Fix it by hand in Stripe.";

/** Record what happened. Returns true when Stripe now matches. */
export async function recordLineReduction(opId: string, subscriptionId: string, outcome: LineReduceOutcome): Promise<boolean> {
  await prisma.$transaction((tx) => {
    if (outcome.kind === "matches" || outcome.kind === "updated") {
      return completeProviderOperation(tx, opId, { status: "SUCCEEDED", providerObjectId: subscriptionId });
    }
    // Left as FAILED (not DRIFT) on purpose: the billing drift screen lists it, the nightly pass re-reads Stripe,
    // and it clears itself the moment Stripe matches (for example after the owner fixes the item by hand).
    if (outcome.kind === "no_item") return completeProviderOperation(tx, opId, { status: "FAILED", error: NO_ITEM_NOTE });
    return completeProviderOperation(tx, opId, { status: outcome.outcome, error: outcome.error });
  });
  return outcome.kind === "matches" || outcome.kind === "updated";
}

export type LineReduceResult = "done" | "skipped" | "pending";
export type LineReduceClaim = Awaited<ReturnType<typeof claimProviderOperation>>;

/**
 * Write the provider-operation claim in the SAME transaction that lowers the line's price, so a decision that
 * commits always has its Stripe update recorded, and one that rolls back leaves nothing behind.
 */
export function claimLineReductionInTx(
  tx: Parameters<typeof claimProviderOperation>[0],
  input: { pendingDeliveryId: string; rentalLineId: string },
): Promise<LineReduceClaim> {
  return claimProviderOperation(tx, {
    kind: "SUBSCRIPTION_UPDATE",
    subjectType: "RentalLine",
    subjectId: input.rentalLineId,
    idempotencyKey: lineReduceKey(input.pendingDeliveryId),
  });
}

/**
 * Send the line reduction to Stripe AFTER the transaction that wrote the claim has committed. Never throws for a
 * provider problem: the outcome is recorded and the billing reconciliation pass retries anything unfinished.
 */
export async function runLineReduction(pendingDeliveryId: string, claim: LineReduceClaim): Promise<LineReduceResult> {
  return runLineChange(() => desiredLineReduction(pendingDeliveryId), claim);
}

async function runLineChange(resolve: () => Promise<LineReduceDesired | null>, claim: LineReduceClaim): Promise<LineReduceResult> {
  if (claim.done) return "done";
  const desired = await resolve();
  if (!desired) return "skipped";
  if (desired.moot) {
    await prisma.$transaction((tx) => completeProviderOperation(tx, claim.opId, { status: "SUCCEEDED", providerObjectId: desired.subscriptionId }));
    return "done";
  }
  const key = await stripeKeyForAttempt(claim.opId, claim.idempotencyKey);
  const outcome = await applyLineReduction(getStripeClient(), desired, key);
  return (await recordLineReduction(claim.opId, desired.subscriptionId, outcome)) ? "done" : "pending";
}

/**
 * Retry an unfinished reduction (the reconciliation pass). Stripe is read first: if it already matches, the
 * operation is simply marked done, which is also how an earlier ambiguous attempt is settled. Only then is the
 * claim taken over and the change sent again.
 */
export async function retryLineReduction(
  operation: { id: string; subjectType: string; subjectId: string; idempotencyKey: string; attempts: number },
  pendingDeliveryId: string,
): Promise<boolean> {
  return retryLineChange(operation, () => desiredLineReduction(pendingDeliveryId));
}

async function retryLineChange(
  operation: { id: string; subjectType: string; subjectId: string; idempotencyKey: string; attempts: number },
  resolve: () => Promise<LineReduceDesired | null>,
): Promise<boolean> {
  const desired = await resolve();
  if (!desired) return false;
  if (desired.moot) {
    await prisma.$transaction((tx) => completeProviderOperation(tx, operation.id, { status: "SUCCEEDED", providerObjectId: desired.subscriptionId }));
    return true;
  }
  const stripe = getStripeClient();
  const state = await readLineState(stripe, desired);
  if (state.kind === "failed") return false;
  if (state.kind === "matches") {
    await prisma.$transaction((tx) => completeProviderOperation(tx, operation.id, { status: "SUCCEEDED", providerObjectId: desired.subscriptionId }));
    return true;
  }
  if (state.kind === "no_item") return recordLineReduction(operation.id, desired.subscriptionId, state);
  const claim = await takeOver(operation);
  if (!claim) return false;
  if (claim.done) return true;
  const key = await stripeKeyForAttempt(claim.opId, claim.idempotencyKey);
  return recordLineReduction(claim.opId, desired.subscriptionId, await sendLineUpdate(stripe, desired, state.item, key));
}

async function takeOver(operation: { subjectType: string; subjectId: string; idempotencyKey: string; attempts: number }) {
  try {
    return await prisma.$transaction((tx) =>
      claimProviderOperation(tx, {
        kind: "SUBSCRIPTION_UPDATE",
        subjectType: operation.subjectType,
        subjectId: operation.subjectId,
        idempotencyKey: operation.idempotencyKey,
        reconcileUnknownAfterProviderEvidence: { expectedAttempts: operation.attempts },
      }),
    );
  } catch (error) {
    if (error instanceof RetryLater) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// W-21B: a set's line repriced to single prices after the customer is done with one machine (D-WB8 case 1). Same durable
// pattern; the operation is keyed by the line amendment, and the target is again the line's current local price.
// ---------------------------------------------------------------------------------------------------------------------

export const lineRepriceKey = (amendmentId: string) => `subscription-line-reprice-${amendmentId}`;

export function parseLineRepriceKey(key: string): string | null {
  const match = /^subscription-line-reprice-(.+)$/.exec(key);
  return match ? match[1]! : null;
}

export async function desiredLineReprice(amendmentId: string): Promise<LineReduceDesired | null> {
  const amendment = await prisma.rentalLineAmendment.findUnique({
    where: { id: amendmentId },
    select: {
      rentalLine: {
        select: {
          id: true,
          monthlyPriceCents: true,
          assignments: { where: { unassignedAt: null }, select: { id: true } },
          agreement: { select: { status: true, stripeSubscriptionId: true } },
        },
      },
    },
  });
  const line = amendment?.rentalLine;
  if (!line?.agreement.stripeSubscriptionId) return null;
  if (line.agreement.status !== "ACTIVE") return { moot: true, subscriptionId: line.agreement.stripeSubscriptionId };
  return {
    moot: false,
    subscriptionId: line.agreement.stripeSubscriptionId,
    rentalLineId: line.id,
    amountCents: line.monthlyPriceCents,
    remove: line.assignments.length === 0,
  };
}

export function claimLineRepriceInTx(
  tx: Parameters<typeof claimProviderOperation>[0],
  input: { amendmentId: string; rentalLineId: string },
): Promise<LineReduceClaim> {
  return claimProviderOperation(tx, {
    kind: "SUBSCRIPTION_UPDATE",
    subjectType: "RentalLine",
    subjectId: input.rentalLineId,
    idempotencyKey: lineRepriceKey(input.amendmentId),
  });
}

export function runLineReprice(amendmentId: string, claim: LineReduceClaim): Promise<LineReduceResult> {
  return runLineChange(() => desiredLineReprice(amendmentId), claim);
}

export function retryLineReprice(
  operation: { id: string; subjectType: string; subjectId: string; idempotencyKey: string; attempts: number },
  amendmentId: string,
): Promise<boolean> {
  return retryLineChange(operation, () => desiredLineReprice(amendmentId));
}
