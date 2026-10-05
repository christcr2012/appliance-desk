import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { checkReminderDelivered, type ReminderCheck } from "@/domains/notices";
import { renewalReminderKey } from "@/domains/notices/renewal-reminder";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import {
  PROVIDER_OPERATION_LEASE_MS,
  RetryLater,
  claimProviderOperation,
  completeProviderOperation,
  runProviderCall,
  sanitizeProviderError,
} from "./provider-ops";
import { cancelAtSecondsFor, stripeKeyForAttempt } from "./subscription-term";

export type SubscriptionEndReason =
  | "TERM_END"
  | "EARLY_ENDING"
  | "MONTH_TO_MONTH_ENDING"
  | "MONTH_TO_MONTH"
  | "RENEWAL_EXTENDS_FIXED"
  | "RENEWAL_EXTENDS_MONTHLY"
  | "HOLDER_CLOSED"
  | "NO_HOLDER";

export type SubscriptionEnd =
  | { mode: "NO_END"; cancelAt: null; reason: SubscriptionEndReason; holderAgreementId: string }
  | { mode: "END_AT"; cancelAt: Date; reason: SubscriptionEndReason; holderAgreementId: string }
  | {
      mode: "CLOSED";
      cancelAt: null;
      reason: "HOLDER_CLOSED" | "NO_HOLDER";
      holderAgreementId: string;
    };

export type SubscriptionEndFacts = {
  stripeSubscriptionId: string;
  holder: null | {
    id: string;
    status: string;
    termMonths: number | null;
    endDate: Date | null;
    terminationEffectiveOn: Date | null;
    terminationRequestedAt: Date | null;
    renewalPreference: string | null;
    autoRenewConsentedAt: Date | null;
  };
  scheduledRenewal: null | {
    id: string;
    termMonths: number | null;
    endDate: Date | null;
    startDate: Date | null;
    createdByAutoRenew: boolean;
  };
  autoRenewEnabled: boolean;
  reminderCheck: ReminderCheck | null;
};

type IntentMode = "NO_END" | "END_AT" | "CLOSED";

type IntentRow = {
  stripeSubscriptionId: string;
  version: number;
  mode: IntentMode;
  cancelAt: Date | null;
  reason: string;
  holderAgreementId: string;
  appliedVersion: number;
  appliedMode: IntentMode | null;
  appliedCancelAt: Date | null;
  appliedAt: Date | null;
  leaseToken: string | null;
  leaseUntil: Date | null;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function wholeSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

function fixedEnd(term: { termMonths: number | null; endDate: Date | null }): Date | null {
  const seconds = cancelAtSecondsFor(term);
  return seconds === null ? null : new Date(seconds * 1000);
}

function earlier(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

function sameDate(a: Date | null, b: Date | null): boolean {
  return a === null ? b === null : b !== null && a.getTime() === b.getTime();
}

function sameAnswer(
  row: Pick<IntentRow, "mode" | "cancelAt" | "reason" | "holderAgreementId">,
  answer: SubscriptionEnd,
): boolean {
  return (
    row.mode === answer.mode &&
    sameDate(row.cancelAt, answer.cancelAt) &&
    row.reason === answer.reason &&
    row.holderAgreementId === answer.holderAgreementId
  );
}

/** Pure billing-end rules. Provider retries never supply a date; they always re-derive it here. */
export function decideSubscriptionEnd(facts: SubscriptionEndFacts): SubscriptionEnd {
  const holder = facts.holder;
  if (!holder) {
    return { mode: "CLOSED", cancelAt: null, reason: "NO_HOLDER", holderAgreementId: "" };
  }
  if (holder.status === "ENDED" || holder.status === "CANCELLED") {
    return {
      mode: "CLOSED",
      cancelAt: null,
      reason: "HOLDER_CLOSED",
      holderAgreementId: holder.id,
    };
  }
  if (holder.status !== "ACTIVE") {
    throw new Error("Subscription held by a non-active agreement");
  }

  const naturalEnd = fixedEnd(holder);
  const requestedEnd = holder.terminationEffectiveOn
    ? wholeSecond(new Date(holder.terminationEffectiveOn.getTime() - 1000))
    : null;
  const ownEnd = earlier(naturalEnd, requestedEnd);

  if (holder.terminationRequestedAt) {
    if (!ownEnd) throw new Error("Agreement has an ending request without an effective ending date.");
    return {
      mode: "END_AT",
      cancelAt: ownEnd,
      reason: holder.termMonths === null ? "MONTH_TO_MONTH_ENDING" : "EARLY_ENDING",
      holderAgreementId: holder.id,
    };
  }

  const renewal = facts.scheduledRenewal;
  const autoMayExtend =
    renewal?.createdByAutoRenew === true &&
    facts.autoRenewEnabled &&
    holder.renewalPreference === "AUTO_RENEW" &&
    holder.autoRenewConsentedAt !== null &&
    facts.reminderCheck === "OK";
  const mayExtend = renewal !== null && (!renewal.createdByAutoRenew || autoMayExtend);

  if (renewal && mayExtend) {
    const renewalEnd = fixedEnd(renewal);
    return renewalEnd
      ? {
          mode: "END_AT",
          cancelAt: renewalEnd,
          reason: "RENEWAL_EXTENDS_FIXED",
          holderAgreementId: holder.id,
        }
      : {
          mode: "NO_END",
          cancelAt: null,
          reason: "RENEWAL_EXTENDS_MONTHLY",
          holderAgreementId: holder.id,
        };
  }

  if (ownEnd) {
    return {
      mode: "END_AT",
      cancelAt: ownEnd,
      reason: "TERM_END",
      holderAgreementId: holder.id,
    };
  }
  return {
    mode: "NO_END",
    cancelAt: null,
    reason: "MONTH_TO_MONTH",
    holderAgreementId: holder.id,
  };
}

/** Read the current holder, its scheduled successor and the automatic-renewal reminder gate. */
export async function loadSubscriptionEndFacts(
  tx: Prisma.TransactionClient,
  stripeSubscriptionId: string,
): Promise<SubscriptionEndFacts> {
  const holder = await tx.rentalAgreement.findFirst({
    where: { stripeSubscriptionId },
    select: {
      id: true,
      status: true,
      termMonths: true,
      endDate: true,
      terminationEffectiveOn: true,
      terminationRequestedAt: true,
      renewalPreference: true,
      autoRenewConsentedAt: true,
    },
  });

  const scheduledRenewal = holder
    ? await tx.rentalAgreement.findFirst({
        where: { renewedFromAgreementId: holder.id, status: "SCHEDULED" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          termMonths: true,
          endDate: true,
          startDate: true,
          createdByAutoRenew: true,
        },
      })
    : null;

  const settings = await tx.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { autoRenewEnabled: true },
  });

  let reminderCheck: ReminderCheck | null = null;
  if (holder && scheduledRenewal?.createdByAutoRenew) {
    reminderCheck =
      holder.endDate && scheduledRenewal.startDate
        ? await checkReminderDelivered(
            tx,
            renewalReminderKey(holder.id, holder.endDate),
            scheduledRenewal.startDate,
          )
        : "NOT_DELIVERED";
  }

  return {
    stripeSubscriptionId,
    holder,
    scheduledRenewal,
    autoRenewEnabled: settings?.autoRenewEnabled === true,
    reminderCheck,
  };
}

/** Persist the derived answer. Call last in a decision transaction, after agreement/customer locks. */
export async function recomputeSubscriptionEndInTx(
  tx: Prisma.TransactionClient,
  stripeSubscriptionId: string,
): Promise<{ version: number; changed: boolean }> {
  const answer = decideSubscriptionEnd(await loadSubscriptionEndFacts(tx, stripeSubscriptionId));
  const now = new Date();
  const inserted = await tx.$executeRaw`
    INSERT INTO "SubscriptionEndIntent" (
      "stripeSubscriptionId", "version", "mode", "cancelAt", "reason", "holderAgreementId",
      "appliedVersion", "attempts", "createdAt", "updatedAt"
    ) VALUES (
      ${stripeSubscriptionId}, 1, ${answer.mode}::"SubscriptionEndMode", ${answer.cancelAt},
      ${answer.reason}, ${answer.holderAgreementId}, 0, 0, ${now}, ${now}
    )
    ON CONFLICT ("stripeSubscriptionId") DO NOTHING
  `;

  const rows = await tx.$queryRaw<IntentRow[]>`
    SELECT * FROM "SubscriptionEndIntent"
    WHERE "stripeSubscriptionId" = ${stripeSubscriptionId}
    FOR UPDATE
  `;
  const current = rows[0];
  if (!current) throw new Error("Subscription end intent disappeared after upsert.");
  if (inserted === 1) return { version: 1, changed: true };
  if (sameAnswer(current, answer)) return { version: current.version, changed: false };

  const nextVersion = current.version + 1;
  await tx.subscriptionEndIntent.update({
    where: { stripeSubscriptionId },
    data: {
      version: nextVersion,
      mode: answer.mode,
      cancelAt: answer.cancelAt,
      reason: answer.reason,
      holderAgreementId: answer.holderAgreementId,
      nextAttemptAt: null,
    },
  });
  return { version: nextVersion, changed: true };
}

/** Resolve an agreement (or its renewal source) to the subscription whose answer must be recomputed. */
export async function recomputeForAgreementInTx(
  tx: Prisma.TransactionClient,
  agreementId: string,
): Promise<string[]> {
  const agreement = await tx.rentalAgreement.findUnique({
    where: { id: agreementId },
    select: { stripeSubscriptionId: true, renewedFromAgreementId: true },
  });
  if (!agreement) return [];
  let subscriptionId = agreement.stripeSubscriptionId;
  if (!subscriptionId && agreement.renewedFromAgreementId) {
    const source = await tx.rentalAgreement.findUnique({
      where: { id: agreement.renewedFromAgreementId },
      select: { stripeSubscriptionId: true },
    });
    subscriptionId = source?.stripeSubscriptionId ?? null;
  }
  if (!subscriptionId) return [];
  await recomputeSubscriptionEndInTx(tx, subscriptionId);
  return [subscriptionId];
}

type LeaseClaim =
  | { kind: "NO_INTENT" }
  | { kind: "APPLIED" }
  | { kind: "BUSY" }
  | { kind: "CLAIMED"; token: string; version: number; answer: SubscriptionEnd };

async function claimIntentLease(stripeSubscriptionId: string): Promise<LeaseClaim> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<IntentRow[]>`
      SELECT * FROM "SubscriptionEndIntent"
      WHERE "stripeSubscriptionId" = ${stripeSubscriptionId}
      FOR UPDATE
    `;
    const current = rows[0];
    if (!current) return { kind: "NO_INTENT" } as const;
    if (current.appliedVersion === current.version) return { kind: "APPLIED" } as const;
    const now = new Date();
    if (current.leaseUntil && current.leaseUntil.getTime() > now.getTime()) {
      return { kind: "BUSY" } as const;
    }

    const answer = decideSubscriptionEnd(await loadSubscriptionEndFacts(tx, stripeSubscriptionId));
    let version = current.version;
    if (!sameAnswer(current, answer)) {
      version += 1;
      await tx.subscriptionEndIntent.update({
        where: { stripeSubscriptionId },
        data: {
          version,
          mode: answer.mode,
          cancelAt: answer.cancelAt,
          reason: answer.reason,
          holderAgreementId: answer.holderAgreementId,
          nextAttemptAt: null,
        },
      });
    }
    const token = randomUUID();
    await tx.subscriptionEndIntent.update({
      where: { stripeSubscriptionId },
      data: { leaseToken: token, leaseUntil: new Date(now.getTime() + PROVIDER_OPERATION_LEASE_MS) },
    });
    return { kind: "CLAIMED", token, version, answer } as const;
  });
}

type FenceResult = "APPLIED" | "NEW_VERSION" | "TAKEN_OVER";

async function fenceSuccess(
  stripeSubscriptionId: string,
  token: string,
  version: number,
  appliedMode: IntentMode,
  appliedCancelAt: Date | null,
): Promise<FenceResult> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<IntentRow[]>`
      SELECT * FROM "SubscriptionEndIntent"
      WHERE "stripeSubscriptionId" = ${stripeSubscriptionId}
      FOR UPDATE
    `;
    const current = rows[0];
    if (!current || current.leaseToken !== token) return "TAKEN_OVER" as const;
    if (current.version !== version) {
      await tx.subscriptionEndIntent.update({
        where: { stripeSubscriptionId },
        data: { leaseToken: null, leaseUntil: null },
      });
      return "NEW_VERSION" as const;
    }

    const now = new Date();
    await tx.subscriptionEndIntent.update({
      where: { stripeSubscriptionId },
      data: {
        appliedVersion: version,
        appliedMode,
        appliedCancelAt,
        appliedAt: now,
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
        leaseToken: null,
        leaseUntil: null,
      },
    });
    const currentKey = `subscription-end-${stripeSubscriptionId}-v${version}`;
    await tx.providerOperation.updateMany({
      where: {
        subjectType: "StripeSubscription",
        subjectId: stripeSubscriptionId,
        idempotencyKey: { not: currentKey },
        status: { in: ["PENDING", "FAILED", "UNKNOWN"] },
      },
      data: { status: "SUPERSEDED", completedAt: now },
    });
    return "APPLIED" as const;
  });
}

async function releaseLease(stripeSubscriptionId: string, token: string): Promise<void> {
  await prisma.subscriptionEndIntent.updateMany({
    where: { stripeSubscriptionId, leaseToken: token },
    data: { leaseToken: null, leaseUntil: null },
  });
}

async function fenceFailure(
  stripeSubscriptionId: string,
  token: string,
  version: number,
  error: unknown,
): Promise<"RETRY" | "NEW_VERSION" | "TAKEN_OVER"> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<IntentRow[]>`
      SELECT * FROM "SubscriptionEndIntent"
      WHERE "stripeSubscriptionId" = ${stripeSubscriptionId}
      FOR UPDATE
    `;
    const current = rows[0];
    if (!current || current.leaseToken !== token) return "TAKEN_OVER" as const;
    if (current.version !== version) {
      await tx.subscriptionEndIntent.update({
        where: { stripeSubscriptionId },
        data: { leaseToken: null, leaseUntil: null, nextAttemptAt: null },
      });
      return "NEW_VERSION" as const;
    }
    const attempts = current.attempts + 1;
    const delays = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];
    const delay = delays[Math.min(attempts - 1, delays.length - 1)]!;
    await tx.subscriptionEndIntent.update({
      where: { stripeSubscriptionId },
      data: {
        attempts,
        nextAttemptAt: new Date(Date.now() + delay),
        lastError: sanitizeProviderError(error),
        leaseToken: null,
        leaseUntil: null,
      },
    });
    return "RETRY" as const;
  });
}

async function fencePastEnd(
  stripeSubscriptionId: string,
  token: string,
  version: number,
): Promise<"PAST_END" | "NEW_VERSION" | "TAKEN_OVER"> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<IntentRow[]>`
      SELECT * FROM "SubscriptionEndIntent"
      WHERE "stripeSubscriptionId" = ${stripeSubscriptionId}
      FOR UPDATE
    `;
    const current = rows[0];
    if (!current || current.leaseToken !== token) return "TAKEN_OVER" as const;
    if (current.version !== version) {
      await tx.subscriptionEndIntent.update({
        where: { stripeSubscriptionId },
        data: { leaseToken: null, leaseUntil: null, nextAttemptAt: null },
      });
      return "NEW_VERSION" as const;
    }
    await tx.subscriptionEndIntent.update({
      where: { stripeSubscriptionId },
      data: {
        lastError: "The end date has passed; ending the rental cancels billing.",
        nextAttemptAt: new Date(Date.now() + 24 * 60 * 60_000),
        leaseToken: null,
        leaseUntil: null,
      },
    });
    return "PAST_END" as const;
  });
}

async function markMatchingOperationSucceeded(stripeSubscriptionId: string, version: number): Promise<void> {
  const key = `subscription-end-${stripeSubscriptionId}-v${version}`;
  const operation = await prisma.providerOperation.findUnique({
    where: { idempotencyKey: key },
    select: { id: true, status: true },
  });
  if (!operation || operation.status === "SUPERSEDED") return;
  await prisma.$transaction((tx) =>
    completeProviderOperation(tx, operation.id, {
      status: "SUCCEEDED",
      providerObjectId: stripeSubscriptionId,
    }),
  );
}

/** Make Stripe converge on the newest persisted answer. Never holds a database lock across a network call. */
export async function applySubscriptionEnd(
  stripeSubscriptionId: string,
): Promise<"APPLIED" | "BUSY" | "RETRY" | "PAST_END" | "TAKEN_OVER" | "NO_INTENT"> {
  for (let round = 0; round < 5; round += 1) {
    const lease = await claimIntentLease(stripeSubscriptionId);
    if (lease.kind === "NO_INTENT") return "NO_INTENT";
    if (lease.kind === "APPLIED") return "APPLIED";
    if (lease.kind === "BUSY") return "BUSY";

    const { token, version, answer } = lease;
    if (answer.mode === "CLOSED") {
      const fenced = await fenceSuccess(stripeSubscriptionId, token, version, "CLOSED", null);
      if (fenced === "NEW_VERSION") continue;
      return fenced === "TAKEN_OVER" ? "TAKEN_OVER" : "APPLIED";
    }

    const stripe = getStripeClient();
    const read = await runProviderCall(() => stripe.subscriptions.retrieve(stripeSubscriptionId));
    if (!read.ok) {
      const fenced = await fenceFailure(stripeSubscriptionId, token, version, read.error);
      if (fenced === "NEW_VERSION") continue;
      return fenced === "TAKEN_OVER" ? "TAKEN_OVER" : "RETRY";
    }

    if (read.value.status === "canceled") {
      const fenced = await fenceSuccess(stripeSubscriptionId, token, version, "CLOSED", null);
      if (fenced === "NEW_VERSION") continue;
      return fenced === "TAKEN_OVER" ? "TAKEN_OVER" : "APPLIED";
    }

    const want = answer.mode === "END_AT" ? Math.floor(answer.cancelAt.getTime() / 1000) : null;
    if (want !== null && want <= Math.floor(Date.now() / 1000) + 60) {
      const fenced = await fencePastEnd(stripeSubscriptionId, token, version);
      if (fenced === "NEW_VERSION") continue;
      return fenced === "TAKEN_OVER" ? "TAKEN_OVER" : "PAST_END";
    }

    const have = read.value.cancel_at ?? null;
    if (have === want) {
      await markMatchingOperationSucceeded(stripeSubscriptionId, version);
      const fenced = await fenceSuccess(
        stripeSubscriptionId,
        token,
        version,
        answer.mode,
        answer.mode === "END_AT" ? answer.cancelAt : null,
      );
      if (fenced === "NEW_VERSION") continue;
      return fenced === "TAKEN_OVER" ? "TAKEN_OVER" : "APPLIED";
    }

    const opKey = `subscription-end-${stripeSubscriptionId}-v${version}`;
    const existing = await prisma.providerOperation.findUnique({
      where: { idempotencyKey: opKey },
      select: { status: true, attempts: true },
    });
    let claim;
    try {
      claim = await prisma.$transaction((tx) =>
        claimProviderOperation(tx, {
          kind: "SUBSCRIPTION_UPDATE",
          subjectType: "StripeSubscription",
          subjectId: stripeSubscriptionId,
          idempotencyKey: opKey,
          ...(existing?.status === "UNKNOWN"
            ? { reconcileUnknownAfterProviderEvidence: { expectedAttempts: existing.attempts } }
            : {}),
        }),
      );
    } catch (error) {
      if (error instanceof RetryLater) {
        await releaseLease(stripeSubscriptionId, token);
        return "BUSY";
      }
      await releaseLease(stripeSubscriptionId, token);
      throw error;
    }

    if (claim.done) {
      await prisma.$transaction(async (tx) => {
        const op = await tx.providerOperation.findUnique({ where: { idempotencyKey: opKey } });
        if (op) {
          await completeProviderOperation(tx, op.id, {
            status: "DRIFT",
            providerObjectId: stripeSubscriptionId,
            note: "Stripe subscription end no longer matches a provider operation already recorded as succeeded.",
          });
        }
      });
      const fenced = await fenceFailure(
        stripeSubscriptionId,
        token,
        version,
        new Error("Stripe subscription end drifted after a succeeded provider operation."),
      );
      if (fenced === "NEW_VERSION") continue;
      return fenced === "TAKEN_OVER" ? "TAKEN_OVER" : "RETRY";
    }

    const providerKey = await stripeKeyForAttempt(claim.opId, claim.idempotencyKey);
    const write = await runProviderCall(() =>
      stripe.subscriptions.update(
        stripeSubscriptionId,
        { cancel_at: want ?? "" },
        { idempotencyKey: providerKey },
      ),
    );
    await prisma.$transaction((tx) =>
      completeProviderOperation(
        tx,
        claim.opId,
        write.ok
          ? { status: "SUCCEEDED", providerObjectId: stripeSubscriptionId }
          : { status: write.outcome, error: write.error },
      ),
    );

    if (!write.ok) {
      const fenced = await fenceFailure(stripeSubscriptionId, token, version, write.error);
      if (fenced === "NEW_VERSION") continue;
      return fenced === "TAKEN_OVER" ? "TAKEN_OVER" : "RETRY";
    }

    const fenced = await fenceSuccess(
      stripeSubscriptionId,
      token,
      version,
      answer.mode,
      answer.mode === "END_AT" ? answer.cancelAt : null,
    );
    if (fenced === "NEW_VERSION") continue;
    return fenced === "TAKEN_OVER" ? "TAKEN_OVER" : "APPLIED";
  }
  return "RETRY";
}

export async function applySubscriptionEnds(ids: readonly string[]): Promise<void> {
  for (const id of [...new Set(ids)]) await applySubscriptionEnd(id);
}

export async function applyDueSubscriptionEnds(limit = 50): Promise<{ applied: number; waiting: number }> {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const now = new Date();
  const rows = await prisma.$queryRaw<Array<{ stripeSubscriptionId: string }>>`
    SELECT "stripeSubscriptionId"
    FROM "SubscriptionEndIntent"
    WHERE "appliedVersion" < "version"
      AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
      AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${now})
    ORDER BY "updatedAt" ASC
    LIMIT ${safeLimit}
  `;
  let applied = 0;
  let waiting = 0;
  for (const row of rows) {
    const result = await applySubscriptionEnd(row.stripeSubscriptionId);
    if (result === "APPLIED") applied += 1;
    else waiting += 1;
  }
  return { applied, waiting };
}

export async function auditSubscriptionEnds(limit = 50): Promise<{ checked: number; stale: number }> {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const agreements = await prisma.rentalAgreement.findMany({
    where: { status: "ACTIVE", stripeSubscriptionId: { not: null } },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: safeLimit,
    select: { stripeSubscriptionId: true },
  });
  let stale = 0;
  for (const agreement of agreements) {
    const id = agreement.stripeSubscriptionId!;
    const recomputed = await prisma.$transaction((tx) => recomputeSubscriptionEndInTx(tx, id));
    if (recomputed.changed) {
      stale += 1;
      await applySubscriptionEnd(id);
    }
  }
  return { checked: agreements.length, stale };
}

/** Renewal start gate: the newest intent must already be confirmed in Stripe for this renewal. */
export async function subscriptionEndCoversRenewal(
  tx: Prisma.TransactionClient,
  stripeSubscriptionId: string,
  renewal: { termMonths: number | null; endDate: Date | null },
): Promise<boolean> {
  const intent = await tx.subscriptionEndIntent.findUnique({
    where: { stripeSubscriptionId },
    select: {
      version: true,
      appliedVersion: true,
      appliedMode: true,
      appliedCancelAt: true,
    },
  });
  if (!intent || intent.appliedVersion !== intent.version) return false;
  const renewalEnd = fixedEnd(renewal);
  if (renewalEnd) {
    return intent.appliedMode === "END_AT" && sameDate(intent.appliedCancelAt, renewalEnd);
  }
  return intent.appliedMode === "NO_END" && intent.appliedCancelAt === null;
}
