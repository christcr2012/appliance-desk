import { Resend } from "resend";
import type { MessageDelivery, MessageState, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isNonProductionDeployment } from "@/lib/deployment-safety";
import { sendEmail } from "@/lib/email";
import { lockCanonicalSmsAddress } from "./sms-address-lock";
import { sendCustomerEmail } from "@/lib/customer-email";
import { getSmsProviderState, sendSms } from "@/lib/sms";
import { recordLeadMessageContactInTx } from "@/domains/leads/contact";
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

type DeliveryClaim = { row: MessageDelivery; ownsSend: boolean };

function asResult(
  row: Pick<MessageDelivery, "id" | "state" | "providerMessageId">,
): DeliverMessageResult {
  return {
    state: row.state,
    deliveryId: row.id,
    providerMessageId: row.providerMessageId,
  };
}

async function claimDelivery(
  tx: Prisma.TransactionClient,
  input: DeliverMessageInput,
): Promise<DeliveryClaim> {
  const recipientAddress = normalizeMessageAddress(
    input.channel,
    input.recipient.address,
  );
  // INSERT ... ON CONFLICT DO NOTHING keeps the transaction usable when an
  // idempotent caller races or repeats a key (a failed CREATE would poison PG tx).
  const inserted = await tx.messageDelivery.createMany({
    data: [{
      idempotencyKey: input.idempotencyKey,
      channel: input.channel,
      purpose: input.purpose,
      templateKey: input.templateKey,
      recipientType: input.recipient.type,
      recipientId: input.recipient.id,
      recipientAddress,
      subjectType: input.subject?.type,
      subjectId: input.subject?.id,
    }],
    skipDuplicates: true,
  });
  const existing = await tx.messageDelivery.findUniqueOrThrow({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (inserted.count === 1) return { row: existing, ownsSend: true };
  if (existing.state !== "FAILED" && existing.state !== "NOT_SENT") {
    return { row: existing, ownsSend: false };
  }

  const reclaimed = await tx.messageDelivery.updateMany({
      where: {
        id: existing.id,
        state: { in: ["FAILED", "NOT_SENT"] },
      },
      data: {
        state: "PENDING",
        attempts: { increment: 1 },
        lastError: null,
        providerMessageId: null,
        acceptedAt: null,
        deliveredAt: null,
      },
    });
  const row = await tx.messageDelivery.findUniqueOrThrow({
      where: { id: existing.id },
    });
  return { row, ownsSend: reclaimed.count === 1 };
}

async function finish(
  id: string,
  state: MessageState,
  input?: {
    providerMessageId?: string;
    lastError?: string;
    acceptedAt?: Date;
    deliveredAt?: Date;
  },
) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.messageDelivery.update({
      where: { id },
      data: {
        state,
        providerMessageId: input?.providerMessageId,
        lastError: input?.lastError,
        acceptedAt: input?.acceptedAt,
        deliveredAt: input?.deliveredAt,
      },
    });
    if (state === "ACCEPTED" || state === "DELIVERED") {
      await recordLeadMessageContactInTx(
        tx,
        row,
        input?.acceptedAt ?? input?.deliveredAt ?? new Date(),
      );
    }
    return row;
  });
}

function mapOutcome(
  result: LowLevelResult,
): Exclude<
  MessageState,
  "PENDING" | "DELIVERED" | "BOUNCED" | "COMPLAINED" | "SUPPRESSED"
> {
  switch (result.outcome) {
    case "SENT":
      return "ACCEPTED";
    case "REJECTED":
      return "FAILED";
    case "NOT_ATTEMPTED":
      return "NOT_SENT";
    case "UNKNOWN":
      return "UNKNOWN";
    default:
      return result.sent ? "ACCEPTED" : "FAILED";
  }
}

export async function deliverMessage(
  input: DeliverMessageInput,
): Promise<DeliverMessageResult> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("A message idempotency key is required.");
  }
  if (!input.recipient.address.trim()) {
    throw new Error("A message recipient is required.");
  }

  // Preserve idempotency without creating a new PENDING row before pre-send
  // checks that can safely fail without ever invoking a provider.
  const existing = await prisma.messageDelivery.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (
    existing &&
    existing.state !== "FAILED" &&
    existing.state !== "NOT_SENT"
  ) {
    return asResult(existing);
  }

  const suppression = await getMarketingSuppression(
    input.channel,
    input.recipient.address,
  );

  const nonProduction = isNonProductionDeployment();
  const blockedMarketing = input.purpose === "MARKETING" && suppression;
  const blockedSmsStop =
    input.channel === "SMS" && suppression?.reason === "stop";
  const blockedBounce =
    input.channel === "EMAIL" &&
    input.purpose === "TRANSACTIONAL" &&
    suppression?.reason === "bounce";

  // Rendering is also guaranteed to happen before claiming PENDING. If it
  // throws, a new delivery has not been created and a retryable FAILED /
  // NOT_SENT row has not been reclaimed.
  const rendered =
    nonProduction || blockedMarketing || blockedBounce || blockedSmsStop ? null : input.render();

  // SMS and STOP serialize under the same canonical phone-address lock.
  // The transaction commits the durable send claim before any provider call;
  // the Twilio network call never happens inside a database transaction.
  const { claim, stopNow } = input.channel === "SMS"
    ? await prisma.$transaction(async (tx) => {
        const address = await lockCanonicalSmsAddress(tx, input.recipient.address);
        const now = await tx.marketingSuppression.findUnique({
          where: { channel_address: { channel: "SMS", address } },
          select: { reason: true },
        });
        return {
          claim: await claimDelivery(tx, input),
          stopNow: now?.reason === "stop",
        };
      })
    : {
        claim: await prisma.$transaction(tx => claimDelivery(tx, input)),
        stopNow: false,
      };
  if (!claim.ownsSend) return asResult(claim.row);
  const delivery = claim.row;

  if (blockedSmsStop || stopNow) {
    return asResult(await finish(delivery.id, "SUPPRESSED", {
      lastError: "suppressed: stop",
    }));
  }
  if (blockedMarketing) {
    return asResult(
      await finish(delivery.id, "SUPPRESSED", {
        lastError: `suppressed: ${suppression!.reason}`,
      }),
    );
  }
  if (blockedBounce) {
    return asResult(
      await finish(delivery.id, "FAILED", {
        lastError: "hard bounce on file",
      }),
    );
  }

  if (nonProduction) {
    return asResult(
      await finish(delivery.id, "NOT_SENT", {
        lastError: "previews never send",
      }),
    );
  }

  const invoke = async (): Promise<LowLevelResult> => {
    if (!rendered) {
      throw new Error("Message content was not rendered before provider invocation.");
    }
    if (input.channel === "SMS") {
      return sendSms({
        to: delivery.recipientAddress,
        body: rendered.text,
        idempotencyKey: input.idempotencyKey,
      });
    }
    const sender = input.customerFacing ? sendCustomerEmail : sendEmail;
    return sender({
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
  if (state === "UNKNOWN" && input.channel === "EMAIL") {
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
          ? input.channel === "SMS"
            ? "provider outcome unknown; held for reconciliation, no automatic SMS retry"
            : "provider outcome unknown after one retry"
          : undefined;
  const acceptedAt = state === "ACCEPTED" ? new Date() : undefined;
  const completed = await finish(delivery.id, state, {
    providerMessageId: provider.providerMessageId,
    acceptedAt,
    lastError,
  });
  return asResult(completed);
}

type ReconciledState =
  | "ACCEPTED"
  | "DELIVERED"
  | "FAILED"
  | "BOUNCED"
  | "COMPLAINED"
  | "UNKNOWN";

async function getEmailProviderState(
  messageId: string,
): Promise<ReconciledState> {
  if (isNonProductionDeployment() || !process.env.RESEND_API_KEY) {
    return "UNKNOWN";
  }
  try {
    const { data, error } = await new Resend(
      process.env.RESEND_API_KEY,
    ).emails.get(messageId);
    if (error || !data) return "UNKNOWN";
    const lastEvent = (data as { last_event?: string | null }).last_event;
    switch (lastEvent) {
      case "delivered":
      case "opened":
      case "clicked":
        return "DELIVERED";
      case "bounced":
        return "BOUNCED";
      case "complained":
        return "COMPLAINED";
      case "failed":
      case "suppressed":
        return "FAILED";
      case "sent":
      case "delivery_delayed":
      case "scheduled":
        return "ACCEPTED";
      default:
        return "UNKNOWN";
    }
  } catch {
    return "UNKNOWN";
  }
}

export async function reconcileUnknownDeliveries(
  limit = 50,
): Promise<{ resolved: number }> {
  const rows = await prisma.messageDelivery.findMany({
    where: { state: "UNKNOWN", providerMessageId: { not: null } },
    orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
    take: Math.max(1, Math.min(limit, 200)),
  });

  let resolved = 0;
  for (const row of rows) {
    const state =
      row.channel === "EMAIL"
        ? await getEmailProviderState(row.providerMessageId!)
        : await getSmsProviderState(row.providerMessageId!);
    if (state === "UNKNOWN") continue;

    const resolvedAt = new Date();
    const changed = await prisma.$transaction(async (tx) => {
      const current = await tx.messageDelivery.findUnique({ where: { id: row.id } });
      if (!current || current.state !== "UNKNOWN") return 0;
      const completed = await tx.messageDelivery.update({
        where: { id: row.id },
        data: {
          state,
          acceptedAt: state === "ACCEPTED" ? resolvedAt : undefined,
          deliveredAt: state === "DELIVERED" ? resolvedAt : undefined,
          lastError: state === "FAILED" ? "provider reports failure" : null,
        },
      });
      if (state === "ACCEPTED" || state === "DELIVERED") {
        await recordLeadMessageContactInTx(tx, completed, resolvedAt);
      }
      return 1;
    });
    resolved += changed;
  }
  return { resolved };
}
