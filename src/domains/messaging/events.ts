import { lockCanonicalSmsAddress } from "./sms-address-lock";
import type { MessageState, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyDeliveryObservationInTx } from "./delivery-state";
import {
  normalizeMessageAddress,
  smsAddressAliases,
  upsertMarketingSuppressionInTx,
} from "./suppression";

type ResendEvent = {
  type: string;
  data?: {
    email_id?: string;
    to?: string | string[];
    bounce?: { type?: string } | null;
  };
};

type TwilioStatusEvent = {
  eventId: string;
  messageSid: string;
  status: string;
  errorCode?: string | null;
};

type TwilioStopEvent = {
  eventId: string;
  from: string;
  keyword: string;
};

async function recordProviderEvent(
  tx: Prisma.TransactionClient,
  input: { provider: string; eventId: string; type: string; summary: Prisma.InputJsonValue },
): Promise<boolean> {
  const inserted = await tx.providerEvent.createMany({
    data: [input],
    skipDuplicates: true,
  });
  return inserted.count === 1;
}

function resendRequestedState(type: string): MessageState | null {
  switch (type) {
    case "email.sent":
    case "email.delivery_delayed":
      return "ACCEPTED";
    case "email.delivered":
    case "email.opened":
    case "email.clicked":
      return "DELIVERED";
    case "email.bounced":
      return "BOUNCED";
    case "email.complained":
      return "COMPLAINED";
    default:
      return null;
  }
}

function firstAddress(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

/** The caller must verify the Resend/Svix signature before calling this. */
export async function processVerifiedResendEvent(
  eventId: string,
  event: ResendEvent,
): Promise<{ duplicate: boolean; matched: boolean }> {
  const providerMessageId = event.data?.email_id ?? null;
  const requested = resendRequestedState(event.type);
  const eventAddress = firstAddress(event.data?.to);

  return prisma.$transaction(async (tx) => {
    const inserted = await recordProviderEvent(tx, {
      provider: "resend",
      eventId,
      type: event.type,
      summary: {
        ...(providerMessageId ? { messageId: providerMessageId } : {}),
        ...(eventAddress ? { address: normalizeMessageAddress("EMAIL", eventAddress) } : {}),
        ...(event.data?.bounce?.type ? { bounceType: event.data.bounce.type } : {}),
      },
    });
    if (!inserted) return { duplicate: true, matched: false };
    if (!providerMessageId || !requested) {
      await tx.providerEvent.updateMany({
        where: { provider: "resend", eventId },
        data: { processedAt: new Date() },
      });
      return { duplicate: false, matched: false };
    }

    const delivery = await tx.messageDelivery.findUnique({
      where: { providerMessageId },
    });
    if (!delivery) {
      await tx.providerEvent.updateMany({
        where: { provider: "resend", eventId },
        data: { processedAt: new Date() },
      });
      return { duplicate: false, matched: false };
    }

    await applyDeliveryObservationInTx(tx, {
      deliveryId: delivery.id, state: requested, observedAt: new Date(),
      lastError: requested === "BOUNCED"
        ? "provider reported a hard bounce"
        : requested === "COMPLAINED"
          ? "recipient reported this message as spam" : undefined,
    });

    if ((requested === "BOUNCED" || requested === "COMPLAINED") && delivery.channel === "EMAIL") {
      await upsertMarketingSuppressionInTx(tx, {
        channel: "EMAIL",
        address: delivery.recipientAddress,
        reason: requested === "BOUNCED" ? "bounce" : "complaint",
        source: `resend_event:${eventId}`,
      });

      const notice = await tx.customerNotice.findUnique({
        where: { providerMessageId },
        select: { id: true },
      });
      if (notice) {
        await tx.customerNotice.update({
          where: { id: notice.id },
          data: {
            status: "UNCERTAIN",
            lastError:
              requested === "BOUNCED"
                ? "The email provider later reported that this notice bounced. Review delivery evidence and contact the customer another way."
                : "The recipient later reported this notice email as spam. Review delivery evidence and contact the customer another way.",
          },
        });
      }
    }

    await tx.providerEvent.updateMany({
      where: { provider: "resend", eventId },
      data: { processedAt: new Date() },
    });
    return { duplicate: false, matched: true };
  });
}

function twilioRequestedState(status: string): MessageState | null {
  switch (status.toLowerCase()) {
    case "accepted":
    case "scheduled":
    case "queued":
    case "sending":
    case "sent":
      return "ACCEPTED";
    case "delivered":
    case "read":
      return "DELIVERED";
    case "failed":
    case "undelivered":
    case "canceled":
      return "FAILED";
    default:
      return null;
  }
}

type TwilioReceiptSummary = {
  messageId: string;
  status: string;
  errorCode?: string;
  matchState?: "unmatched";
};

function validTwilioReceiptSummary(raw: unknown): TwilioReceiptSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.messageId !== "string" || !/^[A-Za-z0-9_-]{4,90}$/.test(data.messageId) ||
      typeof data.status !== "string" || !/^[A-Za-z_]{2,25}$/.test(data.status) ||
      (data.errorCode !== undefined &&
        (typeof data.errorCode !== "string" || !/^[A-Za-z0-9_-]{1,24}$/.test(data.errorCode)))) {
    return null;
  }
  return { messageId: data.messageId, status: data.status,
    ...(data.errorCode ? { errorCode: data.errorCode as string } : {}) };
}

/** A receipt lock is always acquired before the delivery lock. */
async function applyTwilioReceiptInTx(
  tx: Prisma.TransactionClient, eventId: string,
): Promise<"matched" | "pending" | "ignored"> {
  const locked = await tx.$queryRaw<{id: string}[]>`
    SELECT "id" FROM "ProviderEvent"
    WHERE "provider" = 'twilio' AND "eventId" = ${eventId} FOR UPDATE
  `;
  if (!locked.length) throw new Error("Verified Twilio receipt was not persisted");
  const receipt = await tx.providerEvent.findUniqueOrThrow({
    where: { provider_eventId: { provider: "twilio", eventId } },
  });
  if (receipt.processedAt) return "ignored";
  const summary = validTwilioReceiptSummary(receipt.summary);
  const requested = summary && twilioRequestedState(summary.status);
  if (!summary || !requested) {
    await tx.providerEvent.update({ where: { id: receipt.id },
      data: { processedAt: new Date() } });
    return "ignored";
  }
  const delivery = await tx.messageDelivery.findUnique({
    where: { providerMessageId: summary.messageId },
  });
  if (!delivery || delivery.channel !== "SMS") {
    await tx.providerEvent.update({
      where: { id: receipt.id },
      data: { summary: { ...summary, matchState: "unmatched" } },
    });
    return "pending";
  }
  await applyDeliveryObservationInTx(tx, {
    deliveryId: delivery.id, state: requested, observedAt: new Date(),
    lastError: requested === "FAILED"
      ? summary.errorCode
        ? `Twilio delivery failure ${summary.errorCode}`
        : "Twilio reported delivery failure"
      : undefined,
  });
  await tx.providerEvent.update({ where: { id: receipt.id },
    data: { processedAt: new Date() } });
  return "matched";
}

/** Caller verifies the signed webhook before persisting any receipt. */
export async function processVerifiedTwilioStatusEvent(
  input: TwilioStatusEvent,
): Promise<{ duplicate: boolean; matched: boolean }> {
  return prisma.$transaction(async (tx) => {
    const inserted = await recordProviderEvent(tx, {
      provider: "twilio",
      eventId: input.eventId,
      type: `message.${input.status.toLowerCase().slice(0,25)}`,
      summary: {
        messageId: input.messageSid,
        status: input.status,
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      },
    });
    const outcome = await applyTwilioReceiptInTx(tx, input.eventId);
    return { duplicate: !inserted, matched: outcome === "matched" };
  });
}

/** Bounded, lock-safe replay for out-of-order verified status callbacks. */
export async function replayUnmatchedTwilioStatusEvents(
  limit = 50,
): Promise<{ matched: number; pending: number }> {
  const receipts = await prisma.providerEvent.findMany({
    where: { provider: "twilio", type: { startsWith: "message." }, processedAt: null },
    select: { eventId: true },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    take: Math.max(1, Math.min(200, limit)),
  });
  let matched = 0;
  let pending = 0;
  for (const receipt of receipts) {
    const result = await prisma.$transaction(tx =>
      applyTwilioReceiptInTx(tx, receipt.eventId));
    if (result === "matched") matched++;
    if (result === "pending") pending++;
  }
  return { matched, pending };
}

/** STOP is one atomic privacy/consent operation: preference, evidence and suppression. */
export async function processVerifiedTwilioStop(
  input: TwilioStopEvent,
): Promise<{ duplicate: boolean; customerId: string | null }> {
  const address = normalizeMessageAddress("SMS", input.from);
  const aliases = smsAddressAliases(input.from);
  return prisma.$transaction(async (tx) => {
    await lockCanonicalSmsAddress(tx, address);
    const inserted = await recordProviderEvent(tx, {
      provider: "twilio",
      eventId: input.eventId,
      type: "message.stop",
      summary: { address, keyword: input.keyword },
    });
    if (!inserted) return { duplicate: true, customerId: null };

    const customer = await tx.customer.findFirst({
      where: { phone: { in: aliases } },
      select: { id: true },
    });

    await upsertMarketingSuppressionInTx(tx, {
      channel: "SMS",
      address,
      reason: "stop",
      source: `twilio_stop:${input.eventId}`,
    });

    if (customer) {
      await tx.customer.update({
        where: { id: customer.id },
        data: { smsOptInAt: null },
      });
      await tx.consentRecord.create({
        data: {
          customerId: customer.id,
          kind: "sms_opt_out",
          details: { source: "twilio_stop", eventId: input.eventId, phone: address },
        },
      });
    }

    await tx.providerEvent.updateMany({
      where: { provider: "twilio", eventId: input.eventId },
      data: { processedAt: new Date() },
    });
    return { duplicate: false, customerId: customer?.id ?? null };
  });
}
