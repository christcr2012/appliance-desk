import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { lockCanonicalSmsAddress } from "./sms-address-lock";
import { communicationsPolicySchema, evaluateSmsEligibility } from "./communications-policy";
import { decryptCommunicationContent } from "./communications-content";
import { applyDeliveryObservationInTx } from "./delivery-state";
import { makeTwilioSmsProvider } from "@/lib/communications/providers/twilio-sms";
import type { TelecomSmsProvider, SmsSubmitOutcome } from "@/lib/communications/providers/types";

export type CommunicationDispatchOutcome =
  | { kind: "ACCEPTED" | "REJECTED" | "UNKNOWN" | "NOT_ATTEMPTED"; deliveryId: string }
  | { kind: "BLOCKED" | "ALREADY_CLAIMED" | "CONFLICT"; deliveryId: string };

type Claimed = {
  kind: "CLAIMED";
  deliveryId: string;
  attemptId: string;
  accountSid: string;
  accountEnvironment: "PRODUCTION" | "TEST";
  from: string;
  to: string;
  text: string;
  callbackOrigin?: string;
};
type ClaimResult = Claimed | Exclude<CommunicationDispatchOutcome, { kind: "ACCEPTED" | "REJECTED" | "UNKNOWN" | "NOT_ATTEMPTED" }>;

const TEST_DB_PATH = "/appliance_desk_test";
function disposableHarness(): boolean {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.pathname === TEST_DB_PATH;
  } catch {
    return false;
  }
}
function liveDeployment(): boolean {
  return process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";
}

/**
 * One durable claim serializes with STOP, owner deactivation, and an observed
 * status callback. Provider network traffic happens only after commit.
 */
async function claimPreparedCommunication(
  deliveryId: string, now: Date, verifiedDestinationCountry?: "US",
): Promise<ClaimResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "MessageDelivery" WHERE "id" = ${deliveryId} FOR UPDATE`;
    const delivery = await tx.messageDelivery.findUnique({
      where: { id: deliveryId },
      include: { telecomAccount: true, currentAttempt: true,
        communicationMessage: { include: { thread: {
          include: { businessNumber: true, externalContactPoint: true, account: true },
        } } } },
    });
    if (!delivery || delivery.channel !== "SMS" || !delivery.actorUserId ||
      !delivery.telecomAccount || !delivery.currentAttempt ||
      !delivery.communicationMessage || !delivery.renderedBody ||
      delivery.communicationMessage.thread.accountId !== delivery.telecomAccountId ||
      delivery.currentAttempt.deliveryId !== delivery.id ||
      delivery.currentAttempt.accountId !== delivery.telecomAccountId ||
      delivery.currentAttempt.state !== "PREPARED" || delivery.state !== "PENDING" ||
      delivery.recipientId !== delivery.communicationMessage.thread.externalContactPointId ||
      delivery.recipientAddress !== delivery.communicationMessage.thread.externalContactPoint.address ||
      delivery.subjectId !== delivery.communicationMessage.thread.id ||
      delivery.environment !== delivery.telecomAccount.environment ||
      delivery.origin !== "MANUAL") {
      return { kind: "ALREADY_CLAIMED", deliveryId } as const;
    }

    const thread = delivery.communicationMessage.thread;
    await assertActiveTeamActor(tx, delivery.actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "CommunicationThread" WHERE "id" = ${thread.id} FOR UPDATE`;
    const address = await lockCanonicalSmsAddress(tx, thread.externalContactPoint.address);

    const priorStop = await tx.marketingSuppression.findUnique({
      where: { channel_address: { channel: "SMS", address } },
    });
    const settings = await tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { customerSmsEnabled: true, communicationsPolicy: true,
        communicationsPolicyVersion: true },
    });
    const consents = await tx.consentRecord.findMany({
      where: { contactPointId: thread.externalContactPointId },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { id: true, contactPointId: true, purpose: true, action: true,
        source: true, occurredAt: true, createdAt: true, disclosureVersion: true,
        textHash: true, scope: true },
    });
    const eligible = evaluateSmsEligibility({
      enabled: settings?.customerSmsEnabled === true,
      policyValue: settings?.communicationsPolicy,
      policyVersion: settings?.communicationsPolicyVersion ?? 0,
      account: thread.account, number: thread.businessNumber,
      thread, point: thread.externalContactPoint,
      purpose: delivery.purpose,
      verifiedDestinationCountry,
      consents, now,
    });
    if (priorStop || !eligible.allowed || delivery.communicationMessage.consentRecordId !==
      (eligible.allowed ? eligible.consentRecordId : null)) {
      const reason = priorStop ? "STOP" : eligible.allowed ? "CONSENT_CHANGED" : eligible.reason;
      await tx.messageAttempt.update({ where: { id: delivery.currentAttempt.id },
        data: { state: "NOT_SENT", finishedAt: now, errorCode: reason } });
      await applyDeliveryObservationInTx(tx, { deliveryId, state: priorStop ? "SUPPRESSED" : "NOT_SENT",
        observedAt: now, lastError: reason });
      return { kind: "BLOCKED", deliveryId } as const;
    }

    if ((thread.account.environment !== "PRODUCTION" && !disposableHarness()) ||
      (thread.account.environment === "PRODUCTION" && !liveDeployment())) {
      await tx.messageAttempt.update({ where: { id: delivery.currentAttempt.id },
        data: { state: "NOT_SENT", finishedAt: now, errorCode: "ENVIRONMENT_FENCE" } });
      await applyDeliveryObservationInTx(tx, { deliveryId, state: "NOT_SENT",
        observedAt: now, lastError: "ENVIRONMENT_FENCE" });
      return { kind: "BLOCKED", deliveryId } as const;
    }
    const text = decryptCommunicationContent(delivery.renderedBody);
    await tx.messageAttempt.update({ where: { id: delivery.currentAttempt.id },
      data: { state: "DISPATCHING", startedAt: now } });
    return {
      kind: "CLAIMED", deliveryId,
      attemptId: delivery.currentAttempt.id,
      accountSid: thread.account.externalAccountId,
      accountEnvironment: thread.account.environment,
      from: thread.businessNumber.address,
      to: address, text,
      callbackOrigin: eligible.policy.productionWebhookOrigin,
    } as const;
  });
}

/**
 * Exactly one attempt can transition PREPARED -> DISPATCHING. Missing provider,
 * callback configuration or a nonproduction environment never contacts Twilio.
 * Passing a fake is allowed only against CI's disposable localhost DB.
 */
export async function dispatchCommunication(
  deliveryId: string,
  options: { provider?: TelecomSmsProvider; callbackOrigin?: string; now?: Date } = {},
): Promise<CommunicationDispatchOutcome> {
  const now = options.now ?? new Date();
  // A real production dispatch first requests Twilio's FREE Basic Lookup
  // WITHOUT paid Fields, outside any database transaction. It verifies the
  // precise E.164 number is valid and belongs to the US (not just +1).
  // All mutable sender/consent/STOP/actor gates are independently rechecked
  // under locks after this observation. When in doubt, fail closed.
  let observedSid: string | null = null;
  let countryVerified: "US" | undefined;
  let liveProvider: TelecomSmsProvider | null = null;
  if (liveDeployment()) {
    const row = await prisma.messageDelivery.findUnique({
      where: { id: deliveryId },
      select: { recipientAddress: true, telecomAccount: {
        select: { id: true, environment: true, externalAccountId: true },
      } },
    });
    const settings = await prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { customerSmsEnabled: true, communicationsPolicy: true, communicationsPolicyVersion: true },
    });
    const policy = communicationsPolicySchema.safeParse(settings?.communicationsPolicy);
    // Avoid even the FREE metadata lookup until the owner has enabled both
    // independent switches and supplied an approved HTTPS callback origin.
    if (settings?.customerSmsEnabled === true && policy.success &&
        policy.data.manualSmsEnabled && policy.data.productionWebhookOrigin &&
        policy.data.approvedPolicyVersion === settings.communicationsPolicyVersion &&
        policy.data.primaryAccountId === row?.telecomAccount?.id &&
        row?.telecomAccount?.environment === "PRODUCTION") {
      observedSid = row.telecomAccount.externalAccountId;
      liveProvider = makeTwilioSmsProvider(observedSid);
      if (liveProvider?.verifyUsDestination &&
          await liveProvider.verifyUsDestination(row.recipientAddress)) {
        countryVerified = "US";
      }
    }
  }
  const claimed = await claimPreparedCommunication(deliveryId, now, countryVerified);
  if (claimed.kind !== "CLAIMED") return claimed;
  const allowFake = disposableHarness() && claimed.accountEnvironment === "TEST";
  const provider = allowFake ? options.provider ?? null
    : countryVerified === "US" && observedSid === claimed.accountSid ? liveProvider : null;
  const origin = allowFake ? options.callbackOrigin : claimed.callbackOrigin;
  let callbackUrl: string | null = null;
  try {
    if (origin) {
      const url = new URL("/api/webhooks/twilio", origin);
      if (url.protocol === "https:" && url.username === "" && url.password === "" &&
          url.hostname && !url.hostname.includes("_")) {
        url.searchParams.set("attempt", claimed.attemptId);
        callbackUrl = url.toString();
      }
    }
  } catch {
    // Invalid/missing origin is definitely not a provider request.
  }
  let result: SmsSubmitOutcome = !provider || !callbackUrl
    ? { kind: "NOT_ATTEMPTED", reason: "PROVIDER_NOT_CONFIGURED" }
    : { kind: "UNKNOWN" };
  if (provider && callbackUrl) {
    try {
      result = await provider.sendSms({
        operationId: claimed.attemptId, from: claimed.from, to: claimed.to,
        text: claimed.text, callbackUrl,
      });
    } catch {
      result = { kind: "UNKNOWN" };
    }
  }

  const state = result.kind === "ACCEPTED" ? "ACCEPTED"
    : result.kind === "REJECTED" ? "FAILED"
    : result.kind === "NOT_ATTEMPTED" ? "NOT_SENT" : "UNKNOWN";
  const attemptState = result.kind === "REJECTED" ? "REJECTED"
    : result.kind === "NOT_ATTEMPTED" ? "NOT_SENT" : result.kind;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MessageDelivery" WHERE "id" = ${deliveryId} FOR UPDATE`;
      const attempt = await tx.messageAttempt.findUnique({
        where: { id: claimed.attemptId },
        select: { state: true, deliveryId: true },
      });
      if (!attempt || attempt.deliveryId !== deliveryId || attempt.state !== "DISPATCHING") {
        return; // Never overwrite a verified callback or separately reconciled claim.
      }
      await tx.messageAttempt.update({ where: { id: claimed.attemptId },
        data: { state: attemptState, finishedAt: new Date(),
          ...(result.kind === "ACCEPTED" ? { providerResourceId: result.resourceId } : {}),
          ...(result.kind === "REJECTED" ? { errorCode: result.code } : {}),
          ...(result.kind === "NOT_ATTEMPTED" ? { errorCode: result.reason } : {}),
        },
      });
      await applyDeliveryObservationInTx(tx, {
        deliveryId, state, observedAt: new Date(),
        ...(result.kind === "ACCEPTED" ? { providerMessageId: result.resourceId } : {}),
        ...(result.kind === "REJECTED" ? { lastError: result.code } : {}),
        ...(result.kind === "NOT_ATTEMPTED" ? { lastError: result.reason } : {}),
      });
    });
  } catch {
    // Provider may have accepted before a failed DB commit. Leave DISPATCHING
    // intact for conservative stale-claim reconciliation. Never call send again.
    return { kind: "UNKNOWN", deliveryId };
  }
  return { kind: result.kind, deliveryId };
}

/** A crashed/abandoned claimed POST is UNKNOWN, not automatically retryable. */
export async function reconcileStaleCommunicationClaims(
  now: Date = new Date(), limit = 50,
): Promise<number> {
  const rows = await prisma.messageAttempt.findMany({
    where: { state: "DISPATCHING", startedAt: { lt: new Date(now.getTime() - 5 * 60_000) },
      delivery: { channel: "SMS", origin: "MANUAL", communicationMessage: { isNot: null } } },
    select: { id: true, deliveryId: true },
    take: Math.min(Math.max(1, Math.trunc(limit)), 100),
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  });
  let changed = 0;
  for (const row of rows) {
    const applied = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MessageDelivery" WHERE "id" = ${row.deliveryId} FOR UPDATE`;
      const attempt = await tx.messageAttempt.findUnique({
        where: { id: row.id }, select: { state: true, startedAt: true },
      });
      if (attempt?.state !== "DISPATCHING" ||
          attempt.startedAt.getTime() >= now.getTime() - 5 * 60_000) return false;
      await tx.messageAttempt.update({
        where: { id: row.id }, data: { state: "UNKNOWN",
          errorCode: "DISPATCH_RECOVERY_REQUIRED", finishedAt: now },
      });
      await applyDeliveryObservationInTx(tx, {
        deliveryId: row.deliveryId, state: "UNKNOWN",
        observedAt: now, lastError: "DISPATCH_RECOVERY_REQUIRED",
      });
      return true;
    });
    if (applied) changed++;
  }
  return changed;
}
