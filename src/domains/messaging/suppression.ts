import type { MessageChannel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Canonical form for SMS provider calls, ledger rows and suppression keys.
 * The business currently serves US customers, so a bare 10-digit number is
 * interpreted as +1. Explicit international E.164 numbers are preserved.
 */
export function normalizeSmsAddress(address: string): string {
  const trimmed = address.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+")) {
    if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
    throw new Error("Enter a valid phone number including country code.");
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  throw new Error("Enter a valid 10-digit US phone number or E.164 number.");
}

/** Common historic display/storage forms for matching pre-E4 customer rows. */
export function smsAddressAliases(address: string): string[] {
  const normalized = normalizeSmsAddress(address);
  const aliases = new Set<string>([normalized, address.trim()]);
  if (normalized.startsWith("+1") && normalized.length === 12) {
    const ten = normalized.slice(2);
    const area = ten.slice(0, 3);
    const exchange = ten.slice(3, 6);
    const line = ten.slice(6);
    aliases.add(ten);
    aliases.add(`1${ten}`);
    aliases.add(`(${area}) ${exchange}-${line}`);
    aliases.add(`${area}-${exchange}-${line}`);
    aliases.add(`${area} ${exchange} ${line}`);
    aliases.add(`${area}.${exchange}.${line}`);
    aliases.add(`+1 (${area}) ${exchange}-${line}`);
  }
  return [...aliases];
}

export function normalizeMessageAddress(
  channel: MessageChannel,
  address: string,
): string {
  const trimmed = address.trim();
  return channel === "EMAIL" ? trimmed.toLowerCase() : normalizeSmsAddress(trimmed);
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
