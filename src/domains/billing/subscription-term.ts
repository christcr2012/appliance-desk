import { prisma } from "@/lib/prisma";
import { businessDateEnd, businessDateFromKey, businessDateKey } from "@/lib/business-date";

/**
 * Shared date/idempotency helpers for Stripe subscription lifecycle work.
 *
 * Batch B2 moved every end-date write onto subscription-end.ts. The old
 * per-renewal extend/revert and per-termination sync functions intentionally no
 * longer live here; these helpers remain because subscription creation,
 * reconciliation of old operation keys and provider-attempt idempotency still
 * need the exact same date/key rules.
 */

export type TermSyncDirection = "extend" | "revert";

export function cancelAtSecondsFor(term: { termMonths: number | null; endDate: Date | null }): number | null {
  return term.termMonths && term.endDate
    ? Math.floor(businessDateEnd(businessDateKey(term.endDate)).getTime() / 1000)
    : null;
}

/**
 * The instant Stripe is told a new subscription started (owner decision IN-28,
 * 2026-10-04: billing begins on delivery). It is always Colorado midnight at the
 * start of the real first-delivery day, whether the subscription is created that
 * day or weeks later, so Stripe bills from delivery and keeps that delivery-day
 * rhythm. Deriving it from the delivery date alone (never from "today") keeps the
 * request identical on every retry, which Stripe requires for a reused idempotency key.
 */
export function subscriptionStartSecondsFor(firstDeliveredOn: Date): number {
  const start = businessDateFromKey(businessDateKey(firstDeliveredOn));
  if (!start) throw new Error("The first-delivery date is not a valid calendar date.");
  return Math.floor(start.getTime() / 1000);
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

/** Stripe replays the stored answer for a repeated idempotency key (including a failure), so a retry uses a new key. */
export async function stripeKeyForAttempt(opId: string, baseKey: string): Promise<string> {
  const op = await prisma.providerOperation.findUnique({ where: { id: opId }, select: { attempts: true } });
  const attempts = op?.attempts ?? 1;
  return attempts > 1 ? `${baseKey}-a${attempts}` : baseKey;
}
