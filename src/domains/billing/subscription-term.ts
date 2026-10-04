import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { addBusinessDays } from "@/lib/business-date";
import { isAutoRenewEnabled } from "@/domains/settings/auto-renew-switch";
import { checkReminderDelivered } from "@/domains/notices";
import { renewalReminderKey } from "@/domains/notices/renewal-reminder";
import {
  stripeBillingDateSeconds,
  stripeBillingDateSecondsAtProviderClock,
} from "./stripe-billing-anchor";
import {
  claimProviderOperation,
  completeProviderOperation,
  RetryLater,
  runProviderCall,
} from "./provider-ops";

/**
 * The provider boundary Stripe is told about for a fixed-term rental.
 *
 * Appliance Desk stores the agreement end as the last real Colorado second of
 * service. New Stripe subscriptions recur at the DST-safe 07:00 UTC
 * representation of each Colorado billing date. `cancel_at` therefore uses the
 * matching provider boundary at the start of the following Colorado business
 * date. Existing subscriptions can predate that contract, so term/termination
 * writes read their actual Stripe billing-cycle anchor and preserve its UTC
 * clock rather than crossing into a new provider period.
 *
 * A renewal CONTINUES that same subscription, so before the old term ends the
 * subscription's provider boundary has to move to the renewal's end date (or
 * be removed for month-to-month). It must happen while the subscription is
 * still live (at signing), not at the start date, because Stripe has already
 * ended it by then.
 *
 * Every change is a durable provider operation (idempotent, recoverable by the
 * billing reconciliation pass), and the target is always derived from the
 * agreements' current state, so a retry can never apply stale data:
 *   extend: the renewal's term applies (renewal SCHEDULED or ACTIVE)
 *   revert: the renewal was cancelled, so the old term applies again
 */

export type TermSyncDirection = "extend" | "revert";

type NaturalTerm = { termMonths: number | null; endDate: Date | null };
type EndingTerm = NaturalTerm & { terminationEffectiveOn: Date | null };

function cancelOnFor(term: NaturalTerm): Date | null {
  return term.termMonths && term.endDate ? addBusinessDays(term.endDate, 1) : null;
}

function cancelOnForAgreement(term: EndingTerm): Date | null {
  const natural = cancelOnFor(term);
  if (!term.terminationEffectiveOn) return natural;
  if (!natural) return term.terminationEffectiveOn;
  return stripeBillingDateSeconds(term.terminationEffectiveOn) < stripeBillingDateSeconds(natural)
    ? term.terminationEffectiveOn
    : natural;
}

export function cancelAtSecondsFor(term: NaturalTerm): number | null {
  const cancelOn = cancelOnFor(term);
  return cancelOn ? stripeBillingDateSeconds(cancelOn) : null;
}

/**
 * The provider end boundary for an agreement whose owner/customer asked to end
 * it early. `terminationEffectiveOn` is the Colorado billing anniversary on
 * which the next period must not begin, so Stripe cancels exactly at that
 * anniversary's provider clock. An early ending that falls on or after the
 * natural term boundary changes nothing.
 */
export function cancelAtSecondsForAgreement(term: EndingTerm): number | null {
  const cancelOn = cancelOnForAgreement(term);
  return cancelOn ? stripeBillingDateSeconds(cancelOn) : null;
}

/**
 * Resolve a logical Colorado cancellation date onto an existing subscription's
 * real UTC billing clock. This keeps legacy subscriptions on their actual cycle
 * boundary while new subscriptions naturally resolve to the 07:00 UTC contract.
 */
export function cancelAtSecondsForProviderClock(
  cancelOn: Date | null,
  billingCycleAnchorSeconds: number,
): number | null {
  return cancelOn
    ? stripeBillingDateSecondsAtProviderClock(cancelOn, billingCycleAnchorSeconds)
    : null;
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
      createdByAutoRenew: true,
      startDate: true,
    },
  });
  if (!renewal?.renewedFromAgreementId) return null;
  const old = await prisma.rentalAgreement.findUnique({
    where: { id: renewal.renewedFromAgreementId },
    select: {
      id: true,
      termMonths: true,
      endDate: true,
      terminationEffectiveOn: true,
      terminationRequestedAt: true,
      renewalPreference: true,
      stripeSubscriptionId: true,
    },
  });
  if (!old) return null;
  return { renewal, old, subscriptionId: renewal.stripeSubscriptionId ?? old.stripeSubscriptionId };
}

/** The end date that should be on the subscription right now, or "none" when nothing applies. */
export async function desiredSubscriptionTerm(renewalId: string, direction: TermSyncDirection) {
  const pair = await loadPair(renewalId);
  if (!pair || !pair.subscriptionId) return null;
  const { renewal, old } = pair;
  // An automatic renewal only extends billing once the customer's reminder was delivered on time:
  // until then Stripe keeps the old end date, so nothing is billed past the term for a renewal that cannot start.
  if (direction === "extend" && renewal.createdByAutoRenew && renewal.status !== "CANCELLED") {
    // The customer's current choice always wins: an opt-out or an early-ending request that has been
    // saved but whose renewal has not been cancelled yet must never let billing be extended.
    if (!(await isAutoRenewEnabled())) return null;
    if (old.renewalPreference !== "AUTO_RENEW" || old.terminationRequestedAt !== null || renewal.status !== "SCHEDULED") {
      return null;
    }
    const oldFull = await prisma.rentalAgreement.findUnique({ where: { id: old.id }, select: { endDate: true } });
    if (!oldFull?.endDate || !renewal.startDate) return null;
    const check = await checkReminderDelivered(prisma, renewalReminderKey(old.id, oldFull.endDate), renewal.startDate);
    if (check !== "OK") return null;
  }
  // An extend that is overtaken by a cancellation is moot; the revert covers it.
  if (direction === "extend" && renewal.status === "CANCELLED") return { moot: true as const, subscriptionId: pair.subscriptionId };
  const cancelOn =
    direction === "extend"
      ? cancelOnFor(renewal)
      : // Giving the old term back must not undo an early ending that was asked for meanwhile.
        cancelOnForAgreement(old);
  const cancelAt = cancelOn ? stripeBillingDateSeconds(cancelOn) : null;
  return { moot: false as const, subscriptionId: pair.subscriptionId, cancelOn, cancelAt };
}

/** Stripe replays the stored answer for a repeated idempotency key (including a failure), so a retry uses a new key. */
export async function stripeKeyForAttempt(opId: string, baseKey: string): Promise<string> {
  const op = await prisma.providerOperation.findUnique({ where: { id: opId }, select: { attempts: true } });
  const attempts = op?.attempts ?? 1;
  return attempts > 1 ? `${baseKey}-a${attempts}` : baseKey;
}

export type TermSyncResult = "done" | "skipped" | "pending";

async function actualProviderCancelAt(
  stripe: ReturnType<typeof getStripeClient>,
  desired: { subscriptionId: string; cancelOn: Date | null },
): Promise<{ ok: true; cancelAt: number | null } | { ok: false; error: unknown }> {
  if (!desired.cancelOn) return { ok: true, cancelAt: null };
  const read = await runProviderCall(() => stripe.subscriptions.retrieve(desired.subscriptionId));
  if (!read.ok) return { ok: false, error: read.error };
  return {
    ok: true,
    cancelAt: cancelAtSecondsForProviderClock(desired.cancelOn, read.value.billing_cycle_anchor),
  };
}

/** Make Stripe's end date match the agreements. Never throws for a provider problem: the outcome is recorded and retried by reconciliation. */
export async function syncSubscriptionTerm(
  renewalId: string,
  direction: TermSyncDirection,
): Promise<TermSyncResult> {
  const desired = await desiredSubscriptionTerm(renewalId, direction);
  if (!desired) return "skipped";

  let claim;
  try {
    claim = await prisma.$transaction((tx) =>
      claimProviderOperation(tx, {
        kind: "SUBSCRIPTION_UPDATE",
        subjectType: "RentalAgreement",
        subjectId: renewalId,
        idempotencyKey: termSyncKey(renewalId, direction),
      }),
    );
  } catch (error) {
    // Another worker is already making this same change: report it as still in progress instead of failing the caller.
    if (error instanceof RetryLater) return "pending";
    throw error;
  }
  if (claim.done) return "done";

  if (desired.moot) {
    await prisma.$transaction((tx) =>
      completeProviderOperation(tx, claim.opId, { status: "SUCCEEDED", providerObjectId: desired.subscriptionId }),
    );
    return "done";
  }

  const stripe = getStripeClient();
  const actual = await actualProviderCancelAt(stripe, desired);
  if (!actual.ok) {
    // The provider read is safe to repeat: no Stripe mutation was attempted, so
    // record a definite local retry rather than an ambiguous write outcome.
    await prisma.$transaction((tx) =>
      completeProviderOperation(tx, claim.opId, { status: "FAILED", error: actual.error }),
    );
    return "pending";
  }

  const key = await stripeKeyForAttempt(claim.opId, claim.idempotencyKey);
  const result = await runProviderCall(() =>
    stripe.subscriptions.update(
      desired.subscriptionId,
      { cancel_at: actual.cancelAt ?? "" },
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
  const cancelOn = cancelOnForAgreement(agreement);
  return {
    moot: false as const,
    subscriptionId: agreement.stripeSubscriptionId,
    cancelOn,
    cancelAt: cancelOn ? stripeBillingDateSeconds(cancelOn) : null,
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

  let claim;
  try {
    claim = await prisma.$transaction((tx) =>
      claimProviderOperation(tx, {
        kind: "SUBSCRIPTION_UPDATE",
        subjectType: "RentalAgreement",
        subjectId: agreementId,
        idempotencyKey: terminationSyncKey(agreementId),
      }),
    );
  } catch (error) {
    if (error instanceof RetryLater) return "pending";
    throw error;
  }
  if (claim.done) return "done";

  if (desired.moot) {
    await prisma.$transaction((tx) =>
      completeProviderOperation(tx, claim.opId, { status: "SUCCEEDED", providerObjectId: desired.subscriptionId }),
    );
    return "done";
  }

  const stripe = getStripeClient();
  const actual = await actualProviderCancelAt(stripe, desired);
  if (!actual.ok) {
    await prisma.$transaction((tx) =>
      completeProviderOperation(tx, claim.opId, { status: "FAILED", error: actual.error }),
    );
    return "pending";
  }

  const key = await stripeKeyForAttempt(claim.opId, claim.idempotencyKey);
  const result = await runProviderCall(() =>
    stripe.subscriptions.update(
      desired.subscriptionId,
      { cancel_at: actual.cancelAt ?? "" },
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