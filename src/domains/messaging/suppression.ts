import type { MessageChannel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export function normalizeMessageAddress(
  channel: MessageChannel,
  address: string,
): string {
  const trimmed = address.trim();
  return channel === "EMAIL" ? trimmed.toLowerCase() : trimmed;
}

export async function getMarketingSuppression(
  channel: MessageChannel,
  address: string,
) {
  return prisma.marketingSuppression.findUnique({
    where: {
      channel_address: {
        channel,
        address: normalizeMessageAddress(channel, address),
      },
    },
  });
}

export async function upsertMarketingSuppressionInTx(
  tx: Prisma.TransactionClient,
  input: {
    channel: MessageChannel;
    address: string;
    reason: string;
    source: string;
  },
) {
  const address = normalizeMessageAddress(input.channel, input.address);
  return tx.marketingSuppression.upsert({
    where: { channel_address: { channel: input.channel, address } },
    create: { ...input, address },
    update: { reason: input.reason, source: input.source },
  });
}
