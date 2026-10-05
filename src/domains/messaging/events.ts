import type { MessageState, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeMessageAddress, upsertMarketingSuppressionInTx } from "./suppression";

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

const TERMINAL_STATES = new Set<MessageState>([
  "DELIVERED",
  "BOUNCED",
  "COMPLAINED",
  "SUPPRESSED",
]);

function nextState(current: MessageState, requested: MessageState): MessageState {
  if (current === requested) return current;
  if (TERMINAL_STATES.has(current)) return current;
  if (requested === "ACCEPTED" && current !== "PENDING" && current !== "UNKNOWN") return current;
  return requested;
}

async function recordProviderEvent(
  tx: Prisma.TransactionClient,
  input: { provider: string; eventId: string; type: string; summary: Prisma.InputJsonValue },
): Promise<boolean> {
  const existing = await tx.providerEvent.findUnique({
    where: { provider_eventId: { provider: input.provider, eventId: input.eventId } },
    select: { id: true },
  });
  if (existing) return false;
  await tx.providerEvent.create({ data: input });
  return true;
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

    const state = nextState(delivery.state, requested);
    if (state !== delivery.state) {
      await tx.messageDelivery.update({
        where: { id: delivery.id },
        data: {
          state,
          ...(state === "DELIVERED" ? { deliveredAt: new Date(), lastError: null } : {}),
          ...(state === "BOUNCED" ? { lastError: "provider reported a hard bounce" } : {}),
          ...(state === "COMPLAINED" ? { lastError: "recipient reported this message as spam" } : {}),
        },
      });
    }

    if ((requested === "BOUNCED" || requested === "COMPLAINED") && delivery.channel === "EMAIL") {
      await upsertMarketingSuppressionInTx(tx, {
        channel: "EMAIL",
        address: delivery.recipientAddress,
        reason: requested === "BOUNCED" ? "bounce" : "complaint",
        source: `resend_event:${eventId}`,
      });

      const notice = await tx.customerNotice.findUnique({
        where: { providerMessageId },
        select: { id: true, status: true },
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

/** The caller must validate X-Twilio-Signature before calling this. */
export async function processVerifiedTwilioStatusEvent(
  input: TwilioStatusEvent,
): Promise<{ duplicate: boolean; matched: boolean }> {
  const requested = twilioRequestedState(input.status);
  return prisma.$transaction(async (tx) => {
    const inserted = await recordProviderEvent(tx, {
      provider: "twilio",
      eventId: input.eventId,
      type: `message.${input.status.toLowerCase()}`,
      summary: {
        messageId: input.messageSid,
        status: input.status,
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      },
    });
    if (!inserted) return { duplicate: true, matched: false };

    const delivery = await tx.messageDelivery.findUnique({
      where: { providerMessageId: input.messageSid },
    });
    if (!delivery || !requested) {
      await tx.providerEvent.updateMany({
        where: { provider: "twilio", eventId: input.eventId },
        data: { processedAt: new Date() },
      });
      return { duplicate: false, matched: false };
    }

    const state = nextState(delivery.state, requested);
    if (state !== delivery.state) {
      await tx.messageDelivery.update({
        where: { id: delivery.id },
        data: {
          state,
          ...(state === "DELIVERED" ? { deliveredAt: new Date(), lastError: null } : {}),
          ...(state === "FAILED" ? { lastError: input.errorCode ? `Twilio delivery failure ${input.errorCode}` : "Twilio reported delivery failure" } : {}),
        },
      });
    }
    await tx.providerEvent.updateMany({
      where: { provider: "twilio", eventId: input.eventId },
      data: { processedAt: new Date() },
    });
    return { duplicate: false, matched: true };
  });
}

/** STOP is one atomic privacy/consent operation: preference, evidence and suppression. */
export async function processVerifiedTwilioStop(
  input: TwilioStopEvent,
): Promise<{ duplicate: boolean; customerId: string | null }> {
  const address = normalizeMessageAddress("SMS", input.from);
  return prisma.$transaction(async (tx) => {
    const inserted = await recordProviderEvent(tx, {
      provider: "twilio",
      eventId: input.eventId,
      type: "message.stop",
      summary: { address, keyword: input.keyword },
    });
    if (!inserted) return { duplicate: true, customerId: null };

    const customer = await tx.customer.findFirst({
      where: { phone: address },
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
          details: { source: "twilio_stop", eventId: input.eventId },
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
