import type { Prisma } from "@prisma/client";
import { normalizeSmsAddress } from "./suppression";

/** One serialization point for verified STOP and the final durable SMS claim. */
export async function lockCanonicalSmsAddress(
  tx: Prisma.TransactionClient,
  address: string,
): Promise<string> {
  const normalized = normalizeSmsAddress(address);
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${"sms-stop:" + normalized}, 0))
  `;
  return normalized;
}
