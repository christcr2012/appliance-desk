import { reviewedCopyDigest } from "@/domains/language/review";
import { approvedSpanishSources, translationFromSnapshot } from "@/domains/language/runtime";
import type { TranslationSource } from "@/domains/language/drafts";
import type { CommunicationLinkEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { lockCanonicalSmsAddress } from "./sms-address-lock";
import { evaluateSmsEligibility, type SmsEligibility } from "./communications-policy";
import { encryptCommunicationContent, hashCommunicationContent } from "./communications-content";
import { renderSmsTemplate, smsPreview, type VariableRules } from "./sms-template";

export type RequestCommunicationInput = {
  threadId: string;
  operationKey: string;
  expectedThreadVersion: number;
  templateRevisionId?: string;
  variables?: Record<string, string>;
  body?: string;
};

/**
 * Server-only extras. `verifiedDestinationCountry` is passed ONLY by a caller that already ran the free provider lookup
 * (outside any database transaction); without it a live (production) account always blocks. `links` ties the new
 * message to the record it is about (a lead, estimate, agreement, job...) inside the same transaction.
 */
export type RequestCommunicationOptions = {
  verifiedDestinationCountry?: "US";
  links?: { entityType: CommunicationLinkEntityType; entityId: string }[];
  now?: Date;
};

export type RequestCommunicationResult =
  | { kind: "QUEUED"; deliveryId: string; messageId: string; attemptId: string; replay: boolean }
  | { kind: "BLOCKED"; reason:
    "MASTER_OFF" | "POLICY_OFF" | "SENDER_NOT_READY" | "NO_RESOLVED_CONTACT" |
    "SUPPRESSED" | "NO_SCOPED_CONSENT" | "INVALID_DESTINATION" | "QUIET_HOURS" }
  | { kind: "CONFLICT" };

function isValidInput(input: RequestCommunicationInput): boolean {
  return input.threadId.length > 0 &&
    /^[a-zA-Z0-9:_-]{8,120}$/.test(input.operationKey) &&
    Number.isSafeInteger(input.expectedThreadVersion) &&
    input.expectedThreadVersion > 0 &&
    (Boolean(input.templateRevisionId) !== Boolean(input.body)) &&
    (!input.variables || (Boolean(input.templateRevisionId) &&
      Object.keys(input.variables).length <= 25 &&
      Object.values(input.variables).every(v => typeof v === "string")));
}

type PreparedText = { text: string; purpose: "TRANSACTIONAL" | "MARKETING" | "CONVERSATIONAL";
  revisionId: string | null; templateKey: string; contentLanguage?: "en" | "es"; translationCopyDigest?: string };

async function preparedText(tx: Prisma.TransactionClient, input: RequestCommunicationInput, spanishSources: TranslationSource[]):
  Promise<PreparedText | null> {
  if (input.templateRevisionId) {
    const template = await tx.communicationTemplateRevision.findUnique({
      where: { id: input.templateRevisionId },
    });
    if (!template || !template.isCurrent || !template.approvedAt ||
      !template.approvedByUserId || template.channel !== "SMS") return null;
    try {
      const raw = template.variables;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const rules = raw as VariableRules;
      let body = template.body;
      let contentLanguage: "en" | "es" = "en";
      if (spanishSources.length) {
        const thread = await tx.communicationThread.findUnique({where:{id:input.threadId},select:{customer:{select:{preferredLanguage:true,archivedAt:true}}}});
        if (thread?.customer?.preferredLanguage === "es" && !thread.customer.archivedAt) {
          body = translationFromSnapshot(spanishSources,"COMMUNICATION",template.id+":body",template.body);
          contentLanguage = "es";
        }
      }
      const text = renderSmsTemplate(body, rules, input.variables ?? {});
      if (!text.trim() || text.length > 1600) return null;
      return { text, purpose: template.purpose,
        revisionId: template.id, templateKey: template.key, contentLanguage,
        translationCopyDigest: contentLanguage === "es" ? reviewedCopyDigest(spanishSources) : undefined };
    } catch { return null; }
  }
  const body = input.body?.trim();
  if (!body || body.length > 1000) return null;
  return { text: body, purpose: "CONVERSATIONAL", revisionId: null,
    templateKey: "manual" };
}

/**
 * Prepare an immutable intent, NOT a provider request. COM-L4B is the only
 * component allowed to claim/send prepared attempts. No external call is made.
 */
export async function requestCommunication(
  actorUserId: string,
  input: RequestCommunicationInput,
  options: RequestCommunicationOptions = {},
): Promise<RequestCommunicationResult> {
  if (!isValidInput(input)) return { kind: "CONFLICT" };
  if ((options.links?.length ?? 0) > 5) return { kind: "CONFLICT" };

  const spanishSources = input.templateRevisionId ? await approvedSpanishSources() : [];

  // Key availability is required even if currently blocked. No plaintext fallback.
  const key = "com:v1:" + input.operationKey;
  const intentHash = hashCommunicationContent(JSON.stringify({
    actorUserId, threadId: input.threadId, templateRevisionId: input.templateRevisionId ?? null,
    variables: input.variables ?? null, body: input.body ?? null,
  }));

  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    // Lock the idempotency key before reading. Concurrent same-key callers
    // observe the first committed intent rather than writing duplicates.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"com-intent:" + key}, 0))`;
    const prior = await tx.messageDelivery.findUnique({ where: { idempotencyKey: key } });
    if (prior) {
      if (prior.requestHash !== intentHash || !prior.currentAttemptId ||
        prior.actorUserId !== actorUserId || prior.subjectId !== input.threadId) {
        return { kind: "CONFLICT" } as const;
      }
      const message = await tx.communicationMessage.findUnique({
        where: { deliveryId: prior.id }, select: { id: true },
      });
      if (!message) return { kind: "CONFLICT" } as const;
      return { kind: "QUEUED", replay: true, deliveryId: prior.id,
        messageId: message.id, attemptId: prior.currentAttemptId } as const;
    }

    await tx.$queryRaw`SELECT "id" FROM "CommunicationThread" WHERE "id" = ${input.threadId} FOR UPDATE`;
    const thread = await tx.communicationThread.findUnique({
      where: { id: input.threadId },
      include: { account: true, businessNumber: true, externalContactPoint: true },
    });
    if (!thread || thread.version !== input.expectedThreadVersion) return { kind: "CONFLICT" } as const;

    await lockCanonicalSmsAddress(tx, thread.externalContactPoint.address);
    // The already-active STOP ledger predates ContactPoint; retain its
    // authority for every ordinary SMS, not marketing alone.
    const legacyStop = await tx.marketingSuppression.findUnique({
      where: { channel_address: { channel: "SMS",
        address: thread.externalContactPoint.address } },
    });
    if (legacyStop) return { kind: "BLOCKED", reason: "SUPPRESSED" } as const;
    const settings = await tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { customerSmsEnabled: true, communicationsPolicy: true,
        communicationsPolicyVersion: true },
    });
    const template = await preparedText(tx, input, spanishSources);
    if (!template) return { kind: "CONFLICT" } as const;

    // The current address-specific consent evidence is read while holding its
    // canonical advisory lock. New STOP/consent commands must take the same lock.
    const consents = await tx.consentRecord.findMany({
      where: { contactPointId: thread.externalContactPointId },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { id: true, contactPointId: true, purpose: true, action: true,
        source: true, occurredAt: true, createdAt: true,
        disclosureVersion: true, textHash: true, scope: true },
    });
    const result: SmsEligibility = evaluateSmsEligibility({
      enabled: settings?.customerSmsEnabled === true,
      policyValue: settings?.communicationsPolicy,
      policyVersion: settings?.communicationsPolicyVersion ?? 0,
      account: thread.account,
      number: thread.businessNumber,
      point: thread.externalContactPoint,
      thread,
      consents,
      purpose: template.purpose,
      verifiedDestinationCountry: options.verifiedDestinationCountry,
      now: options.now ?? new Date(),
    });
    if (!result.allowed) return { kind: "BLOCKED", reason: result.reason } as const;

    // No provider has yet independently verified the destination country in a
    // PRODUCTION environment. Until COM-L4B adds that read-only evidence, the
    // evaluator above fails closed for production. TEST allows schema/logic proof.
    const body = template.text;
    if (smsPreview(body).segments > result.policy.maxSegments ||
      body.length > 1600) return { kind: "CONFLICT" } as const;
    const bodyHash = hashCommunicationContent(body);
    const encrypted = encryptCommunicationContent(body);
    const delivery = await tx.messageDelivery.create({ data: {
      idempotencyKey: key, channel: "SMS", purpose: template.purpose,
      contentLanguage: template.contentLanguage ?? "en", translationCopyDigest: template.translationCopyDigest,
      templateKey: template.templateKey, templateRevisionId: template.revisionId,
      recipientType: "ContactPoint", recipientId: thread.externalContactPointId,
      recipientAddress: thread.externalContactPoint.address,
      subjectType: "CommunicationThread", subjectId: thread.id,
      telecomAccountId: thread.accountId, environment: thread.account.environment,
      actorUserId, origin: "MANUAL", renderedBody: encrypted,
      requestHash: intentHash, state: "PENDING",
    } });
    const attempt = await tx.messageAttempt.create({ data: {
      deliveryId: delivery.id, accountId: thread.accountId, attemptNumber: 1,
      operationKey: key, state: "PREPARED", requestHash: intentHash,
    } });
    const message = await tx.communicationMessage.create({ data: {
      threadId: thread.id, accountId: thread.accountId, direction: "OUTBOUND",
      deliveryId: delivery.id, bodyHash, occurredAt: new Date(),
      actorUserId, consentRecordId: result.consentRecordId,
    } });
    if (options.links?.length) {
      await tx.communicationLink.createMany({
        data: options.links.map((link) => ({ messageId: message.id,
          entityType: link.entityType, entityId: link.entityId,
          source: "WORKFLOW" as const, actorUserId })),
        skipDuplicates: true,
      });
    }
    await tx.messageDelivery.update({
      where: { id: delivery.id }, data: { currentAttemptId: attempt.id },
    });
    await tx.communicationThread.update({
      where: { id: thread.id }, data: { version: { increment: 1 },
        lastActivityAt: message.occurredAt },
    });
    await tx.auditLog.create({ data: {
      userId: actorUserId, action: "COMMUNICATION_INTENT_PREPARED",
      entityType: "CommunicationThread", entityId: thread.id,
      newValue: { deliveryId: delivery.id, consentRecordId: result.consentRecordId,
        purpose: template.purpose, templateRevisionId: template.revisionId },
    } });
    return { kind: "QUEUED", replay: false, deliveryId: delivery.id,
      messageId: message.id, attemptId: attempt.id } as const;
  }, { isolationLevel: "ReadCommitted" });
}
