import type Stripe from "stripe";
import type { ProviderOperationStatus } from "@prisma/client";

import {
  claimProviderOperation,
  completeProviderOperation,
  RetryLater,
  runProviderCall,
} from "@/domains/billing/provider-ops";
import { stripeKeyForAttempt } from "@/domains/billing/subscription-term";
import {
  addBusinessDays,
  businessDateKey,
  businessDayBounds,
} from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { taxRateVersionIdsForAgreement } from "./locations";
import { ensureStripeTaxRate } from "./stripe-rates";

export const TAX_RATE_CHANGES_RULE_KEY = "tax-rate-changes";
export const TAX_ADDRESS_RECHECK_RULE_KEY = "tax-address-recheck";

export function rateStartsTomorrow(
  effectiveFrom: Date,
  now: Date,
): boolean {
  return (
    businessDateKey(effectiveFrom) ===
    businessDateKey(addBusinessDays(now, 1))
  );
}

export function subscriptionTaxUpdateKey(
  agreementId: string,
  rateVersionId: string,
): string {
  return `sub-tax-${agreementId}-${rateVersionId}`;
}

function parseRateVersionId(
  agreementId: string,
  key: string,
): string | null {
  const prefix = `sub-tax-${agreementId}-`;
  return key.startsWith(prefix) && key.length > prefix.length
    ? key.slice(prefix.length)
    : null;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function taxRatesMatch(
  subscription: Stripe.Subscription,
  desiredIds: readonly string[],
): boolean {
  const desired = sortedUnique(desiredIds);
  return subscription.items.data.every((item) => {
    const actual = sortedUnique((item.tax_rates ?? []).map((rate) => rate.id));
    return (
      actual.length === desired.length &&
      actual.every((id, index) => id === desired[index])
    );
  });
}

async function desiredTarget(
  agreementId: string,
  triggerRateVersionId: string,
  taxDate: Date,
): Promise<
  | { kind: "moot"; subscriptionId: string | null }
  | {
      kind: "ready";
      subscriptionId: string;
      rateVersionIds: string[];
    }
> {
  return prisma.$transaction(async (tx) => {
    const agreement = await tx.rentalAgreement.findUnique({
      where: { id: agreementId },
      select: { status: true, stripeSubscriptionId: true },
    });
    if (
      !agreement ||
      agreement.status !== "ACTIVE" ||
      !agreement.stripeSubscriptionId
    ) {
      return {
        kind: "moot" as const,
        subscriptionId: agreement?.stripeSubscriptionId ?? null,
      };
    }

    const rateVersionIds = await taxRateVersionIdsForAgreement(
      tx,
      agreementId,
      taxDate,
      "RENTAL",
    );
    if (!rateVersionIds.includes(triggerRateVersionId)) {
      return {
        kind: "moot" as const,
        subscriptionId: agreement.stripeSubscriptionId,
      };
    }
    return {
      kind: "ready" as const,
      subscriptionId: agreement.stripeSubscriptionId,
      rateVersionIds,
    };
  });
}

async function desiredStripeRateIds(
  rateVersionIds: readonly string[],
): Promise<string[]> {
  return sortedUnique(
    await Promise.all(
      rateVersionIds.map((rateVersionId) =>
        ensureStripeTaxRate(rateVersionId),
      ),
    ),
  );
}

async function readSubscription(
  subscriptionId: string,
): Promise<
  | { ok: true; subscription: Stripe.Subscription }
  | { ok: false; outcome: "FAILED" | "UNKNOWN"; error: unknown }
> {
  const result = await runProviderCall(() =>
    getStripeClient().subscriptions.retrieve(subscriptionId),
  );
  return result.ok
    ? { ok: true, subscription: result.value }
    : {
        ok: false,
        outcome: result.outcome,
        error: result.error,
      };
}

async function sendTaxRateUpdate(
  subscription: Stripe.Subscription,
  desiredIds: readonly string[],
  idempotencyKey: string,
) {
  return runProviderCall(() =>
    getStripeClient().subscriptions.update(
      subscription.id,
      {
        proration_behavior: "none",
        items: subscription.items.data.map((item) => ({
          id: item.id,
          tax_rates: [...desiredIds],
        })),
      },
      { idempotencyKey },
    ),
  );
}

async function markSuperseded(operationId: string): Promise<void> {
  await prisma.providerOperation.updateMany({
    where: {
      id: operationId,
      status: { in: ["PENDING", "FAILED", "UNKNOWN", "DRIFT"] },
    },
    data: {
      status: "SUPERSEDED",
      completedAt: new Date(),
      lastError: null,
    },
  });
}

export type SubscriptionTaxSyncResult =
  | "updated"
  | "already_current"
  | "skipped"
  | "pending";

export async function supersedeSubscriptionTaxUpdatesForRateVersion(
  rateVersionId: string,
): Promise<number> {
  const result = await prisma.providerOperation.updateMany({
    where: {
      kind: "SUBSCRIPTION_TAX_UPDATE",
      idempotencyKey: { endsWith: `-${rateVersionId}` },
      status: { in: ["PENDING", "FAILED", "UNKNOWN", "DRIFT"] },
    },
    data: {
      status: "SUPERSEDED",
      completedAt: new Date(),
      lastError: null,
    },
  });
  return result.count;
}

/**
 * Initial day-before rate-change attempt. The durable operation is claimed
 * before any Stripe read/write so a provider outage is still recoverable after
 * the version is no longer "starting tomorrow".
 */
export async function syncSubscriptionTaxRatesForAgreement(
  agreementId: string,
  triggerRateVersionId: string,
  taxDate: Date,
): Promise<SubscriptionTaxSyncResult> {
  const key = subscriptionTaxUpdateKey(agreementId, triggerRateVersionId);

  let claim;
  try {
    claim = await prisma.$transaction((tx) =>
      claimProviderOperation(tx, {
        kind: "SUBSCRIPTION_TAX_UPDATE",
        subjectType: "RentalAgreement",
        subjectId: agreementId,
        idempotencyKey: key,
      }),
    );
  } catch (error) {
    if (error instanceof RetryLater) {
      const existing = await prisma.providerOperation.findUnique({
        where: { idempotencyKey: key },
        select: { status: true },
      });
      return existing?.status === "SUPERSEDED" ? "skipped" : "pending";
    }
    throw error;
  }
  if (claim.done) return "already_current";

  let target;
  try {
    target = await desiredTarget(
      agreementId,
      triggerRateVersionId,
      taxDate,
    );
  } catch (error) {
    await prisma.$transaction((tx) =>
      completeProviderOperation(tx, claim.opId, {
        status: "FAILED",
        error,
      }),
    );
    return "pending";
  }
  if (target.kind === "moot") {
    await markSuperseded(claim.opId);
    return "skipped";
  }

  let desiredIds: string[];
  try {
    desiredIds = await desiredStripeRateIds(target.rateVersionIds);
  } catch (error) {
    await prisma.$transaction((tx) =>
      completeProviderOperation(tx, claim.opId, {
        status: "FAILED",
        error,
      }),
    );
    return "pending";
  }

  const read = await readSubscription(target.subscriptionId);
  if (!read.ok) {
    await prisma.$transaction((tx) =>
      completeProviderOperation(tx, claim.opId, {
        status: read.outcome,
        error: read.error,
      }),
    );
    return "pending";
  }

  if (read.subscription.items.data.length === 0) {
    await prisma.$transaction((tx) =>
      completeProviderOperation(tx, claim.opId, {
        status: "DRIFT",
        providerObjectId: target.subscriptionId,
        note: "Stripe subscription has no items, so its tax rates could not be updated.",
      }),
    );
    return "pending";
  }

  if (taxRatesMatch(read.subscription, desiredIds)) {
    await prisma.$transaction((tx) =>
      completeProviderOperation(tx, claim.opId, {
        status: "SUCCEEDED",
        providerObjectId: target.subscriptionId,
      }),
    );
    return "already_current";
  }

  const providerKey = await stripeKeyForAttempt(
    claim.opId,
    claim.idempotencyKey,
  );
  const write = await sendTaxRateUpdate(
    read.subscription,
    desiredIds,
    providerKey,
  );
  await prisma.$transaction((tx) =>
    completeProviderOperation(
      tx,
      claim.opId,
      write.ok
        ? {
            status: "SUCCEEDED",
            providerObjectId: target.subscriptionId,
          }
        : {
            status: write.outcome,
            error: write.error,
          },
    ),
  );
  return write.ok ? "updated" : "pending";
}

export type RecoverableTaxRateOperation = {
  id: string;
  subjectType: string;
  subjectId: string;
  idempotencyKey: string;
  status: ProviderOperationStatus;
  attempts: number;
};

/**
 * Billing reconciliation retry. It first reads Stripe as provider evidence:
 * if the prior ambiguous write actually landed, the operation is completed
 * without sending again; otherwise UNKNOWN may safely be reclaimed.
 */
export async function retrySubscriptionTaxUpdate(
  operation: RecoverableTaxRateOperation,
): Promise<boolean> {
  if (operation.subjectType !== "RentalAgreement") {
    await markSuperseded(operation.id);
    return true;
  }
  const rateVersionId = parseRateVersionId(
    operation.subjectId,
    operation.idempotencyKey,
  );
  if (!rateVersionId) {
    await markSuperseded(operation.id);
    return true;
  }
  const version = await prisma.taxRateVersion.findUnique({
    where: { id: rateVersionId },
    select: {
      effectiveFrom: true,
      autoApplied: true,
      autoAppliedUndoneAt: true,
    },
  });
  if (
    !version ||
    (version.autoApplied && version.autoAppliedUndoneAt !== null)
  ) {
    await markSuperseded(operation.id);
    return true;
  }

  const target = await desiredTarget(
    operation.subjectId,
    rateVersionId,
    version.effectiveFrom,
  );
  if (target.kind === "moot") {
    await markSuperseded(operation.id);
    return true;
  }

  const desiredIds = await desiredStripeRateIds(target.rateVersionIds);
  const read = await readSubscription(target.subscriptionId);
  if (!read.ok) return false;

  if (read.subscription.items.data.length === 0) return false;

  if (taxRatesMatch(read.subscription, desiredIds)) {
    await prisma.$transaction((tx) =>
      completeProviderOperation(tx, operation.id, {
        status: "SUCCEEDED",
        providerObjectId: target.subscriptionId,
      }),
    );
    return true;
  }

  let claim;
  try {
    claim = await prisma.$transaction((tx) =>
      claimProviderOperation(tx, {
        kind: "SUBSCRIPTION_TAX_UPDATE",
        subjectType: operation.subjectType,
        subjectId: operation.subjectId,
        idempotencyKey: operation.idempotencyKey,
        ...(operation.status === "UNKNOWN"
          ? {
              reconcileUnknownAfterProviderEvidence: {
                expectedAttempts: operation.attempts,
              },
            }
          : {}),
      }),
    );
  } catch (error) {
    if (error instanceof RetryLater) return false;
    throw error;
  }
  if (claim.done) return true;

  const providerKey = await stripeKeyForAttempt(
    claim.opId,
    claim.idempotencyKey,
  );
  const write = await sendTaxRateUpdate(
    read.subscription,
    desiredIds,
    providerKey,
  );
  await prisma.$transaction((tx) =>
    completeProviderOperation(
      tx,
      claim.opId,
      write.ok
        ? {
            status: "SUCCEEDED",
            providerObjectId: target.subscriptionId,
          }
        : {
            status: write.outcome,
            error: write.error,
          },
    ),
  );
  return write.ok;
}

export async function applyTaxRateChanges(
  now = new Date(),
  options: { includeRateVersionIds?: readonly string[] } = {},
): Promise<{
  versions: number;
  agreements: number;
  updated: number;
  alreadyCurrent: number;
  skipped: number;
  pending: number;
}> {
  const tomorrow = addBusinessDays(now, 1);
  const tomorrowBounds = businessDayBounds(tomorrow);

  const tomorrowVersions = await prisma.taxRateVersion.findMany({
    where: {
      effectiveFrom: {
        gte: tomorrowBounds.start,
        lt: tomorrowBounds.end,
      },
      autoAppliedUndoneAt: null,
    },
    select: {
      id: true,
      jurisdictionId: true,
      effectiveFrom: true,
    },
    orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
  });

  // Once a version has started, only revisit it when durable provider evidence
  // says its subscription update is still unresolved. This heals outages
  // without scanning/reprocessing every historical current rate each day.
  const recoverableOperations = await prisma.providerOperation.findMany({
    where: {
      kind: "SUBSCRIPTION_TAX_UPDATE",
      status: { in: ["PENDING", "FAILED", "UNKNOWN", "DRIFT"] },
    },
    select: {
      subjectId: true,
      idempotencyKey: true,
    },
    orderBy: { requestedAt: "asc" },
  });
  const recoverableRateVersionIds = new Set<string>();
  for (const operation of recoverableOperations) {
    const id = parseRateVersionId(operation.subjectId, operation.idempotencyKey);
    if (id) recoverableRateVersionIds.add(id);
  }

  const requestedIds = new Set<string>([
    ...recoverableRateVersionIds,
    ...(options.includeRateVersionIds ?? []),
  ]);
  const catchUpVersions = requestedIds.size
    ? await prisma.taxRateVersion.findMany({
        where: {
          id: { in: [...requestedIds] },
          effectiveFrom: { lt: tomorrowBounds.end },
          autoAppliedUndoneAt: null,
        },
        select: {
          id: true,
          jurisdictionId: true,
          effectiveFrom: true,
        },
        orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
      })
    : [];

  const versionsById = new Map<
    string,
    { id: string; jurisdictionId: string; effectiveFrom: Date }
  >();
  for (const version of [...tomorrowVersions, ...catchUpVersions]) {
    versionsById.set(version.id, version);
  }
  const versions = [...versionsById.values()].sort(
    (left, right) =>
      left.effectiveFrom.getTime() - right.effectiveFrom.getTime() ||
      left.id.localeCompare(right.id),
  );

  let agreements = 0;
  let updated = 0;
  let alreadyCurrent = 0;
  let skipped = 0;
  let pending = 0;

  for (const version of versions) {
    const affected = await prisma.rentalAgreement.findMany({
      where: {
        status: "ACTIVE",
        stripeSubscriptionId: { not: null },
        serviceAddress: {
          taxLocations: {
            some: {
              isCurrent: true,
              jurisdictions: {
                some: { jurisdictionId: version.jurisdictionId },
              },
            },
          },
        },
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    agreements += affected.length;

    for (const agreement of affected) {
      try {
        const result = await syncSubscriptionTaxRatesForAgreement(
          agreement.id,
          version.id,
          version.effectiveFrom,
        );
        if (result === "updated") updated += 1;
        else if (result === "already_current") alreadyCurrent += 1;
        else if (result === "skipped") skipped += 1;
        else pending += 1;
      } catch (error) {
        console.error(
          `[tax-rate-changes] Could not update ${agreement.id} for rate ${version.id}`,
          error instanceof Error ? error.message : "unknown error",
        );
        pending += 1;
      }
    }
  }

  return {
    versions: versions.length,
    agreements,
    updated,
    alreadyCurrent,
    skipped,
    pending,
  };
}
