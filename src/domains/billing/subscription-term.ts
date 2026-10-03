import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { businessDateEnd, businessDateKey } from "@/lib/business-date";
import {
  claimProviderOperation,
  completeProviderOperation,
  runProviderCall,
} from "./provider-ops";

/**
 * The end date Stripe is told about for a fixed-term rental ("cancel_at").
 *
 * A fixed-term rental's subscription is created with cancel_at = the end of the
 * last day of the term, so Stripe stops billing by itself. A renewal CONTINUES
 * that same subscription, so before the old term ends the subscription's end
 * date has to move to the renewal's end date (or be removed for month-to-month).
 * It must happen while the subscription is still live (at signing), not at the
 * start date, because Stripe has already ended it by then.
 *
 * Every change is a durable provider operation (idempotent, recoverable by the
 * billing reconciliation pass), and the target is always derived from the
 * agreements' current state, so a retry can never apply stale data:
 *   extend: the renewal's term applies (renewal SCHEDULED or ACTIVE)
 *   revert: the renewal was cancelled, so the old term applies again
 */

export type TermSyncDirection = "extend" | "revert";

export function cancelAtSecondsFor(term: { termMonths: number | null; endDate: Date | null }): number | null {
  return term.termMonths && term.endDate
    ? Math.floor(businessDateEnd(businessDateKey(term.endDate)).getTime() / 1000)
    : null;
}

/**
 * The end date for an agreement whose owner/customer asked to end it early: the
 * subscription must stop BEFORE the billing anniversary the agreement ends on, or
 * Stripe would bill one more month. An early ending that falls on or after the
 * natural term end changes nothing.
 */
export function cancelAtSecondsForAgreement(term: {
  termMonths: number | null;
  endDate: Date | null;
  terminationEffectiveOn: Date | null;
}): number | null {
  const natural = cancelAtSecondsFor(term);
  if (!term.terminationEffectiveOn) return natural;
  const early = Math.floor((term.terminationEffectiveOn.getTime() - 1000) / 1000);
  return natural === null || early < natural ? early : natural;
}

export const termSyncKey = (renewalId: string, direction: TermSyncDirection) =>
  `subscription-term-${renewalId}-${direction}`;

export const terminationSyncKey = (agreementId: string) => `subscription-termination-${agreementId}`;

export function parseTerminationSyncKey(key: string): string | null {
  const match = /^subscription-termination-(.+)$/.exec(key);
  return match ? match[1]! : null;
}

export function parseTermSyncKey(key: string): { renewalId: string; direction: TermSyncDirection } | null {
  const match = /^subscription-term-(.+)-(extend|revert)$/.exec(key);
  return match ? { renewalId: match[1]!, direction: match[2] as TermSyncDirection } : null;
}

async function loadPair(renewalId: string) {
  const renewal = await prisma.rentalAgreement.findUnique({
    where: { id: renewalId },
    select: {
      id: true,
      status: true,
      termMonths: true,
      endDate: true,
      stripeSubscriptionId: true,
      renewedFromAgreementId: true,
    },
  });
  if (!renewal?.renewedFromAgreementId) return null;
  const old = await prisma.rentalAgreement.findUnique({
    where: { id: renewal.renewedFromAgreementId },
    select: { id: true, termMonths: true, endDate: true, terminationEffectiveOn: true, stripeSubscriptionId: true },
  });
  if (!old) return null;
  return { renewal, old, subscriptionId: renewal.stripeSubscriptionId ?? old.stripeSubscriptionId };
}

/** The end date that should be on the subscription right now, or "none" when nothing applies. */
export async function desiredSubscriptionTerm(renewalId: string, direction: TermSyncDirection) {
  const pair = await loadPair(renewalId);
  if (!pair || !pair.subscriptionId) return null;
  const { renewal, old } = pair;
  // An extend that is overtaken by a cancellation is moot; the revert covers it.
  if (direction === "extend" && renewal.status === "CANCELLED") return { moot: true as const, subscriptionId: pair.subscriptionId };
  const cancelAt =
    direction === "extend"
      ? cancelAtSecondsFor(renewal)
      : // Giving the old term back must not undo an early ending that was asked for meanwhile.
        cancelAtSecondsForAgreement(old);
  return { moot: false as const, subscriptionId: pair.subscriptionId, cancelAt };
}

/** Stripe replays the stored answer for a repeated idempotency key (including a failure), so a retry uses a new key. */
export async function stripeKeyForAttempt(opId: string, baseKey: string): Promise<string> {
  const op = await prisma.providerOperation.findUnique({ where: { id: opId }, select: { attempts: true } });
  const attempts = op?.attempts ?? 1;
  return attempts > 1 ? `${baseKey}-a${attempts}` : baseKey;
}

export type TermSyncResult = "done" | "skipped" | "pending";

/** Make Stripe's end date match the agreements. Never throws for a provider problem: the outcome is recorded and retried by reconciliation. */
export async function syncSubscriptionTerm(
  renewalId: string,
  direction: TermSyncDirection,
): Promise<TermSyncResult> {
  const desired = await desiredSubscriptionTerm(renewalId, direction);
  if (!desired) return "skipped";

  const claim = await prisma.$transaction((tx) =>
    claimProviderOperation(tx, {
      kind: "SUBSCRIPTION_UPDATE",
      subjectType: "RentalAgreement",
      subjectId: renewalId,
      idempotencyKey: termSyncKey(renewalId, direction),
    }),
  );
  if (claim.done) return "done";

  if (desired.moot) {
    await prisma.$transaction((tx) =>
      completeProviderOperation(tx, claim.opId, { status: "SUCCEEDED", providerObjectId: desired.subscriptionId }),
    );
    return "done";
  }

  const stripe = getStripeClient();
  const key = await stripeKeyForAttempt(claim.opId, claim.idempotencyKey);
  const result = await runProviderCall(() =>
    stripe.subscriptions.update(
      desired.subscriptionId,
      { cancel_at: desired.cancelAt ?? "" },
      { idempotencyKey: key },
    ),
  );
  await prisma.$transaction((tx) =>
    completeProviderOperation(
      tx,
      claim.opId,
      result.ok
        ? { status: "SUCCEEDED", providerObjectId: desired.subscriptionId }
        : { status: result.outcome, error: result.error },
    ),
  );
  return result.ok ? "done" : "pending";
}

/** Has the renewal's extend operation been confirmed by Stripe? */
export async function extendConfirmed(renewalId: string): Promise<boolean> {
  const op = await prisma.providerOperation.findUnique({
    where: { idempotencyKey: termSyncKey(renewalId, "extend") },
    select: { status: true },
  });
  return op?.status === "SUCCEEDED";
}

/** The end date Stripe should have for an agreement that is being ended early. */
export async function desiredTerminationEnd(agreementId: string) {
  const agreement = await prisma.rentalAgreement.findUnique({
    where: { id: agreementId },
    select: {
      status: true,
      termMonths: true,
      endDate: true,
      terminationEffectiveOn: true,
      stripeSubscriptionId: true,
    },
  });
  if (!agreement?.stripeSubscriptionId || !agreement.terminationEffectiveOn) return null;
  // Already ended or cancelled: the close path cancels the subscription itself.
  if (agreement.status !== "ACTIVE") {
    return { moot: true as const, subscriptionId: agreement.stripeSubscriptionId };
  }
  return {
    moot: false as const,
    subscriptionId: agreement.stripeSubscriptionId,
    cancelAt: cancelAtSecondsForAgreement(agreement),
  };
}

/**
 * Tell Stripe to stop billing before the anniversary an early ending falls on.
 * Same durable-operation pattern as `syncSubscriptionTerm`; never throws for a
 * provider problem (reconciliation retries it).
 */
export async function syncTerminationEnd(agreementId: string): Promise<TermSyncResult> {
  const desired = await desiredTerminationEnd(agreementId);
  if (!desired) return "skipped";

  const claim = await prisma.$transaction((tx) =>
    claimProviderOperation(tx, {
      kind: "SUBSCRIPTION_UPDATE",
      subjectType: "RentalAgreement",
      subjectId: agreementId,
      idempotencyKey: terminationSyncKey(agreementId),
    }),
  );
  if (claim.done) return "done";

  if (desired.moot) {
    await prisma.$transaction((tx) =>
      completeProviderOperation(tx, claim.opId, { status: "SUCCEEDED", providerObjectId: desired.subscriptionId }),
    );
    return "done";
  }

  const stripe = getStripeClient();
  const key = await stripeKeyForAttempt(claim.opId, claim.idempotencyKey);
  const result = await runProviderCall(() =>
    stripe.subscriptions.update(
      desired.subscriptionId,
      { cancel_at: desired.cancelAt ?? "" },
      { idempotencyKey: key },
    ),
  );
  await prisma.$transaction((tx) =>
    completeProviderOperation(
      tx,
      claim.opId,
      result.ok
        ? { status: "SUCCEEDED", providerObjectId: desired.subscriptionId }
        : { status: result.outcome, error: result.error },
    ),
  );
  return result.ok ? "done" : "pending";
}

/** Has Stripe confirmed the early end date for this agreement? (No subscription means nothing to confirm.) */
export async function terminationEndConfirmed(agreementId: string): Promise<boolean> {
  const op = await prisma.providerOperation.findUnique({
    where: { idempotencyKey: terminationSyncKey(agreementId) },
    select: { status: true },
  });
  return op?.status === "SUCCEEDED";
}
