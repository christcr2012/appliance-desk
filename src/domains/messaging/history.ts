import type { MessageState } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const STATE_LABELS: Record<MessageState, string> = {
  PENDING: "Waiting to send",
  ACCEPTED: "Accepted by provider",
  FAILED: "Failed",
  UNKNOWN: "Outcome unknown",
  NOT_SENT: "Not sent",
  DELIVERED: "Delivered",
  BOUNCED: "Bounced",
  COMPLAINED: "Spam complaint",
  SUPPRESSED: "Suppressed",
};

export function messageStateLabel(state: MessageState): string {
  return STATE_LABELS[state];
}

export type MessageHistoryRow = {
  id: string;
  channel: "EMAIL" | "SMS";
  templateKey: string;
  recipientAddress: string;
  state: MessageState;
  requestedAt: Date;
  acceptedAt: Date | null;
  deliveredAt: Date | null;
};

export async function getMessageHistory(
  recipientType: "Customer" | "Lead",
  recipientId: string,
  limit = 20,
): Promise<MessageHistoryRow[]> {
  return prisma.messageDelivery.findMany({
    where: { recipientType, recipientId },
    select: {
      id: true,
      channel: true,
      templateKey: true,
      recipientAddress: true,
      state: true,
      requestedAt: true,
      acceptedAt: true,
      deliveredAt: true,
    },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    take: Math.max(1, Math.min(limit, 50)),
  });
}
