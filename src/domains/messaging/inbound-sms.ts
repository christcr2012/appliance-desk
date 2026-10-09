import { prisma } from "@/lib/prisma";
import { lockCanonicalSmsAddress } from "./sms-address-lock";
import { normalizeSmsAddress } from "./suppression";
import { encryptCommunicationContent, hashCommunicationContent } from "./communications-content";
import { resolveInboundContact, safeExistingThreadIdentity } from "./inbound-resolution";

export type VerifiedInboundSms = {
  accountSid: string;
  from: string;
  to: string;
  messageSid: string;
  text: string;
  mediaCount: number;
  receivedAt?: Date;
};

export type InboundSmsResult = {
  duplicate: boolean;
  threadId: string | null;
  messageId: string | null;
  resolution: "RESOLVED" | "AMBIGUOUS" | "UNRESOLVED" | null;
};

function isolatedDatabase(): boolean {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.pathname === "/appliance_desk_test";
  } catch { return false; }
}

/** This entrypoint is for already signature-verified Twilio payloads ONLY. */
export async function ingestVerifiedSms(input: VerifiedInboundSms): Promise<InboundSmsResult> {
  const inProduction = process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";
  if (!inProduction && !isolatedDatabase()) {
    throw new Error("Inbound communications are disabled outside production.");
  }
  if (!/^AC[0-9a-fA-F]{32}$/.test(input.accountSid) ||
      !/^(SM|MM)[0-9a-fA-F]{32}$/.test(input.messageSid) ||
      input.accountSid !== process.env.TWILIO_ACCOUNT_SID ||
      typeof input.text !== "string" ||
      Buffer.byteLength(input.text, "utf8") > 12_000 ||
      !Number.isSafeInteger(input.mediaCount) ||
      input.mediaCount < 0 || input.mediaCount > 100) {
    throw new Error("Invalid verified inbound SMS payload.");
  }
  const from = normalizeSmsAddress(input.from);
  const to = normalizeSmsAddress(input.to);
  if (from === to) throw new Error("A phone number cannot message itself.");
  const receivedAt = input.receivedAt ?? new Date();
  const encrypted = encryptCommunicationContent(input.text);
  const hashed = hashCommunicationContent(input.text);

  return prisma.$transaction(async (tx) => {
    const account = await tx.telecomAccount.findFirst({
      where: {
        provider: "twilio", environment: "PRODUCTION",
        externalAccountId: input.accountSid,
        status: { in: ["READY", "DEGRADED"] },
      },
    });
    if (!account) throw new Error("Verified telecom account is unavailable.");
    const number = await tx.businessPhoneNumber.findFirst({
      where: { accountId: account.id, address: to, retiredAt: null,
        registrationStatus: "APPROVED", verifiedAt: { not: null } },
    });
    if (!number) throw new Error("Receiving business number is not registered.");
    const point = await tx.contactPoint.upsert({
      where: { environment_channel_address: {
        environment: "PRODUCTION", channel: "SMS", address: from,
      } },
      create: { environment: "PRODUCTION", channel: "SMS", address: from },
      update: {},
    });
    const key = { accountId: account.id, businessNumberId: number.id,
      externalContactPointId: point.id };
    const previous = await tx.communicationThread.findUnique({
      where: { accountId_businessNumberId_externalContactPointId: key },
      select: { id: true, resolution: true, customerId: true, leadId: true },
    });
    // Use the same thread-then-address ordering as prepared outgoing claims.
    if (previous) {
      await tx.$queryRaw`SELECT "id" FROM "CommunicationThread" WHERE "id" = ${previous.id} FOR UPDATE`;
    }
    await lockCanonicalSmsAddress(tx, from);
    const inserted = await tx.providerEvent.createMany({
      data: [{
        provider: "twilio", eventId: "sms-inbound:" + input.messageSid,
        type: "sms.inbound", telecomAccountId: account.id,
        environment: "PRODUCTION", disposition: "APPLIED",
        receivedAt, processedAt: receivedAt,
        summary: { mediaUnsupported: input.mediaCount > 0, mediaCount: input.mediaCount },
      }],
      skipDuplicates: true,
    });
    if (inserted.count === 0) {
      const original = await tx.communicationMessage.findUnique({
        where: { accountId_providerResourceId: {
          accountId: account.id, providerResourceId: input.messageSid,
        } },
      });
      return { duplicate: true, threadId: original?.threadId ?? null,
        messageId: original?.id ?? null, resolution: null } as const;
    }
    const verified = await tx.contactBinding.findMany({
      where: { contactPointId: point.id, revokedAt: null, verifiedAt: { not: null } },
      select: { verifiedAt: true, revokedAt: true, customerId: true, leadId: true,
        customerContact: { select: { customerId: true } } },
    });
    const resolution = previous
      ? safeExistingThreadIdentity(previous, resolveInboundContact(verified))
      : resolveInboundContact(verified);
    const thread = await tx.communicationThread.upsert({
      where: { accountId_businessNumberId_externalContactPointId: key },
      create: {
        ...key, resolution: resolution.resolution, status: "OPEN",
        customerId: resolution.customerId, leadId: resolution.leadId,
        lastActivityAt: receivedAt,
      },
      update: {
        resolution: resolution.resolution, status: "OPEN",
        customerId: resolution.customerId, leadId: resolution.leadId,
        version: { increment: 1 }, lastActivityAt: receivedAt,
      },
    });
    const message = await tx.communicationMessage.create({ data: {
      threadId: thread.id, accountId: account.id, direction: "INBOUND",
      providerResourceId: input.messageSid,
      bodyEncrypted: encrypted, bodyHash: hashed,
      occurredAt: receivedAt, receivedAt,
    } });
    await tx.auditLog.create({ data: {
      action: "INBOUND_COMMUNICATION_RECORDED",
      entityType: "CommunicationThread", entityId: thread.id,
      newValue: { messageId: message.id, resolution: resolution.resolution,
        mediaUnsupported: input.mediaCount > 0 },
    } });
    return {
      duplicate: false, threadId: thread.id,
      messageId: message.id, resolution: resolution.resolution,
    };
  });
}
