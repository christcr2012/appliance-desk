import type { MessageDelivery, MessageState, Prisma } from "@prisma/client";
import { recordLeadMessageContactInTx } from "@/domains/leads/contact";

const terminal = new Set<MessageState>(["DELIVERED", "BOUNCED", "COMPLAINED", "SUPPRESSED"]);

export function chooseObservedDeliveryState(
  channel: "SMS" | "EMAIL", current: MessageState, requested: MessageState,
): MessageState {
  // NOT_SENT means this attempt never reached the provider; a callback for a
  // different attempt cannot turn it into accepted/delivered evidence.
  if (current === requested || terminal.has(current) || current === "NOT_SENT")
    return current;
  if (requested === "PENDING") return current;
  if (current === "FAILED" && requested === "DELIVERED") return current;
  if (requested === "ACCEPTED" && !["PENDING", "UNKNOWN"].includes(current)) return current;
  if (requested === "UNKNOWN" && current !== "PENDING") return current;
  if (requested === "SUPPRESSED" && current !== "PENDING") return current;
  if (requested === "NOT_SENT" && !["PENDING", "UNKNOWN"].includes(current)) return current;
  if (channel === "SMS" && (requested === "BOUNCED" || requested === "COMPLAINED"))
    return current;
  if (channel === "EMAIL" && (requested === "BOUNCED" || requested === "COMPLAINED") &&
      !["PENDING", "UNKNOWN", "ACCEPTED", "FAILED"].includes(current)) return current;
  if (current === "FAILED" && requested !== "BOUNCED" && requested !== "COMPLAINED") return current;
  return requested;
}

/**
 * All sender, verified callback and reconciliation observations serialize on
 * the persisted delivery row, preserving monotonic callback evidence.
 */
export async function applyDeliveryObservationInTx(
  tx: Prisma.TransactionClient,
  input: {
    deliveryId: string;
    state: MessageState;
    providerMessageId?: string;
    observedAt: Date;
    lastError?: string;
  },
): Promise<MessageDelivery> {
  const locked = await tx.$queryRaw<{id: string}[]>`
    SELECT "id" FROM "MessageDelivery" WHERE "id" = ${input.deliveryId} FOR UPDATE
  `;
  if (!locked.length) throw new Error("Delivery not found");
  const row = await tx.messageDelivery.findUniqueOrThrow({ where: { id: input.deliveryId } });
  const next = chooseObservedDeliveryState(row.channel, row.state, input.state);
  if (next === row.state) return row;
  const completed = await tx.messageDelivery.update({
    where: { id: row.id },
    data: {
      state: next,
      providerMessageId: input.providerMessageId ?? undefined,
      acceptedAt: next === "ACCEPTED" && !row.acceptedAt ? input.observedAt : undefined,
      deliveredAt: next === "DELIVERED" ? input.observedAt : undefined,
      lastError: input.lastError ?? (
        ["ACCEPTED", "DELIVERED"].includes(next) ? null : undefined),
    },
  });
  if (next === "ACCEPTED" || next === "DELIVERED") {
    await recordLeadMessageContactInTx(tx, completed, row.acceptedAt ?? input.observedAt);
  }
  return completed;
}
