import { Resend } from "resend";
import type { MessageState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isNonProductionDeployment } from "@/lib/deployment-safety";
import { sendEmail } from "@/lib/email";
import { getSmsProviderState, sendSms } from "@/lib/sms";
import { isCustomerEmailEnabled } from "@/domains/settings/customer-email-switch";
import {
  getMarketingSuppression,
  normalizeMessageAddress,
} from "./suppression";

export type DeliverMessageInput = {
  idempotencyKey: string;
  channel: "EMAIL" | "SMS";
  purpose: "TRANSACTIONAL" | "MARKETING";
  templateKey: string;
  customerFacing: boolean;
  recipient: { type: string; id?: string; address: string };
  subject?: { type: string; id: string };
  render: () => {
    subject?: string;
    text: string;
    actionLabel?: string;
    marketing?: { postalAddress: string; unsubscribeUrl: string };
  };
};

export type DeliverMessageResult = {
  state: MessageState;
  deliveryId: string;
  providerMessageId: string | null;
};

type LowLevelResult = {
  sent: boolean;
  outcome?: "SENT" | "NOT_ATTEMPTED" | "REJECTED" | "UNKNOWN";
  providerMessageId?: string;
};

function asResult(row: {
  id: string;
  state: MessageState;
  providerMessageId: string | null;
}): DeliverMessageResult {
  return {
    state: row.state,
    deliveryId: row.id,
    providerMessageId: row.providerMessageId,
  };
}

async function claimDelivery(input: DeliverMessageInput) {
  const recipientAddress = normalizeMessageAddress(input.channel, input.recipient.address);
  try {
    return await prisma.messageDelivery.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        channel: input.channel,
        purpose: input.purpose,
        templateKey: input.templateKey,
        recipientType: input.recipient.type,
        recipientId: input.recipient.id,
        recipientAddress,
        subjectType: input.subject?.type,
        subjectId: input.subject?.id,
      },
    });
  } catch (cause) {
    const existing = await prisma.messageDelivery.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (!existing) throw cause;
    if (existing.state !== "FAILED" && existing.state !== "NOT_SENT") return existing;

    const reclaimed = await prisma.messageDelivery.updateMany({
      where: { id: existing.id, state: { in: ["FAILED", "NOT_SENT"] } },
      data: {
        state: "PENDING",
        attempts: { increment: 1 },
        lastError: null,
        providerMessageId: null,
        acceptedAt: null,
        deliveredAt: null,
      },
    });
    if (reclaimed.count === 0) {
      return prisma.messageDelivery.findUniqueOrThrow({ where: { id: existing.id } });
    }
    return prisma.messageDelivery.findUniqueOrThrow({ where: { id: existing.id } });
  }
}

async function finish(
  id: string,
  state: MessageState,
  input?: { providerMessageId?: string; lastError?: string; acceptedAt?: Date; deliveredAt?: Date },
) {
  return prisma.messageDelivery.update({
    where: { id },
    data: {
      state,
      providerMessageId: input?.providerMessageId,
      lastError: input?.lastError,
      acceptedAt: input?.acceptedAt,
      deliveredAt: input?.deliveredAt,
    },
  });
}

function mapOutcome(result: LowLevelResult): Exclude<MessageState, "PENDING" | "DELIVERED" | "BOUNCED" | "COMPLAINED" | "SUPPRESSED"> {
  switch (result.outcome) {
    case "SENT": return "ACCEPTED";
    case "REJECTED": return "FAILED";
    case "NOT_ATTEMPTED": return "NOT_SENT";
    case "UNKNOWN":
    default: return result.sent ? "ACCEPTED" : "UNKNOWN";
  }
}

export async function deliverMessage(input: DeliverMessageInput): Promise<DeliverMessageResult> {
  if (!input.idempotencyKey.trim()) throw new Error("A message idempotency key is required.");
  if (!input.recipient.address.trim()) throw new Error("A message recipient is required.");

  const delivery = await claimDelivery(input);
  if (delivery.state !== "PENDING") return asResult(delivery);

  const suppression = await getMarketingSuppression(input.channel, input.recipient.address);
  if (input.purpose === "MARKETING" && suppression) {
    return asResult(await finish(delivery.id, "SUPPRESSED", { lastError: `suppressed: ${suppression.reason}` }));
  }
  if (input.channel === "EMAIL" && input.purpose === "TRANSACTIONAL" && suppression?.reason === "bounce") {
    return asResult(await finish(delivery.id, "FAILED", { lastError: "hard bounce on file" }));
  }

  if (isNonProductionDeployment()) {
    return asResult(await finish(delivery.id, "NOT_SENT", { lastError: "previews never send" }));
  }
  if (input.channel === "EMAIL" && input.customerFacing && !(await isCustomerEmailEnabled())) {
    return asResult(await finish(delivery.id, "NOT_SENT", { lastError: "customer email switch is off" }));
  }

  const rendered = input.render();
  const invoke = async (): Promise<LowLevelResult> => {
    if (input.channel === "SMS") {
      return sendSms({
        to: input.recipient.address,
        body: rendered.text,
        idempotencyKey: input.idempotencyKey,
      });
    }
    return sendEmail({
      to: input.recipient.address,
      subject: rendered.subject ?? "",
      text: rendered.text,
      actionLabel: rendered.actionLabel,
      idempotencyKey: input.idempotencyKey,
      marketing: rendered.marketing,
    });
  };

  const attempt = async (): Promise<LowLevelResult> => {
    try {
      return await invoke();
    } catch {
      return { sent: false, outcome: "UNKNOWN" };
    }
  };

  let provider = await attempt();
  let state = mapOutcome(provider);
  if (state === "UNKNOWN") {
    await prisma.messageDelivery.update({
      where: { id: delivery.id },
      data: { attempts: { increment: 1 } },
    });
    provider = await attempt();
    state = mapOutcome(provider);
  }

  const lastError =
    state === "FAILED"
      ? "provider rejected message"
      : state === "NOT_SENT"
        ? "sending disabled or not configured"
        : state === "UNKNOWN"
          ? "provider outcome unknown after one retry"
          : undefined;
  const completed = await finish(delivery.id, state, {
    providerMessageId: provider.providerMessageId,
    acceptedAt: state === "ACCEPTED" ? new Date() : undefined,
    lastError,
  });
  return asResult(completed);
}

type ReconciledState = "ACCEPTED" | "DELIVERED" | "FAILED" | "BOUNCED" | "COMPLAINED" | "UNKNOWN";

async function getEmailProviderState(messageId: string): Promise<ReconciledState> {
  if (isNonProductionDeployment() || !process.env.RESEND_API_KEY) return "UNKNOWN";
  try {
    const { data, error } = await new Resend(process.env.RESEND_API_KEY).emails.get(messageId);
    if (error || !data) return "UNKNOWN";
    const lastEvent = (data as { last_event?: string | null }).last_event;
    switch (lastEvent) {
      case "delivered":
      case "opened":
      case "clicked": return "DELIVERED";
      case "bounced": return "BOUNCED";
      case "complained": return "COMPLAINED";
      case "failed":
      case "suppressed": return "FAILED";
      case "sent":
      case "delivery_delayed":
      case "scheduled": return "ACCEPTED";
      default: return "UNKNOWN";
    }
  } catch {
    return "UNKNOWN";
  }
}

export async function reconcileUnknownDeliveries(limit = 50): Promise<{ resolved: number }> {
  const rows = await prisma.messageDelivery.findMany({
    where: { state: "UNKNOWN", providerMessageId: { not: null } },
    orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
    take: Math.max(1, Math.min(limit, 200)),
  });

  let resolved = 0;
  for (const row of rows) {
    const state = row.channel === "EMAIL"
      ? await getEmailProviderState(row.providerMessageId!)
      : await getSmsProviderState(row.providerMessageId!);
    if (state === "UNKNOWN") continue;

    const updated = await prisma.messageDelivery.updateMany({
      where: { id: row.id, state: "UNKNOWN" },
      data: {
        state,
        acceptedAt: state === "ACCEPTED" ? new Date() : undefined,
        deliveredAt: state === "DELIVERED" ? new Date() : undefined,
        lastError: state === "FAILED" ? "provider reports failure" : null,
      },
    });
    resolved += updated.count;
  }
  return { resolved };
}
