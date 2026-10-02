import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type RateLimitOptions = { max: number; windowMs: number };

function storageIdentity(key: string): { id: string; identifier: string } {
  // Public request keys usually contain an IP address. Persist only a one-way
  // digest so the anti-abuse store doesn't become another clear-text IP log.
  const digest = createHash("sha256").update(key).digest("hex");
  return {
    id: `rate_limit_${digest}`,
    identifier: `rate-limit:${digest}`,
  };
}

function parseTimestamps(value: string | undefined): number[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is number =>
        typeof item === "number" && Number.isFinite(item) && item >= 0,
    );
  } catch {
    return [];
  }
}

/**
 * Shared rolling-window limiter for public endpoints.
 *
 * State lives in the existing Better Auth Verification table under a reserved
 * `rate-limit:` namespace, one deterministic row per hashed key. A Postgres
 * transaction-level advisory lock serializes the read/filter/write sequence,
 * so concurrent requests routed to different Vercel instances still observe
 * one shared count. Expired timestamps are discarded every time the key is
 * touched; the row itself is reusable and contains no clear-text IP address.
 */
export async function isRateLimited(
  key: string,
  { max, windowMs }: RateLimitOptions,
): Promise<boolean> {
  if (!key || !Number.isInteger(max) || max < 1 || !Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("Invalid rate-limit configuration.");
  }

  const { id, identifier } = storageIdentity(key);
  const nowMs = Date.now();
  const cutoff = nowMs - windowMs;

  return prisma.$transaction(async (tx) => {
    // pg_advisory_xact_lock returns void. Execute it as a statement rather
    // than asking the adapter to deserialize a result column.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${identifier}, 0))
    `;

    const current = await tx.verification.findUnique({
      where: { id },
      select: { value: true },
    });
    const timestamps = parseTimestamps(current?.value).filter(
      (timestamp) => timestamp > cutoff,
    );

    const limited = timestamps.length >= max;
    if (!limited) timestamps.push(nowMs);

    const expiresAt = new Date(
      (timestamps.at(-1) ?? nowMs) + windowMs,
    );
    await tx.verification.upsert({
      where: { id },
      create: {
        id,
        identifier,
        value: JSON.stringify(timestamps),
        expiresAt,
      },
      update: {
        identifier,
        value: JSON.stringify(timestamps),
        expiresAt,
      },
    });

    return limited;
  });
}