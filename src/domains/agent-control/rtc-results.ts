import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "./authorization";

const DIGEST = (value: string) => createHash("sha256").update(value).digest("hex");
const HANDLE = /^rtc_result_[A-Za-z0-9_-]{43}$/;
const TTL_MS = 24 * 60 * 60_000;

/** Only a previously sanitized, bounded tool response may be stored. */
export async function storeRtcResult(ctx: AgentContext, value: Record<string, unknown>,
  now = new Date()): Promise<string> {
  const payload = JSON.stringify(value);
  if (payload.length > 512_000 || payload.length < 2) throw new Error("RTC_RESULT_SIZE_INVALID");
  const handle = "rtc_result_" + randomBytes(32).toString("base64url");
  await prisma.agentResult.create({
    data: { connectionId: ctx.connectionId, digest: DIGEST(handle),
      payload: JSON.parse(payload), expiresAt: new Date(now.getTime() + TTL_MS) },
  });
  return handle;
}

/** Ownership plus expiry are rechecked on every read. No handle is a grant. */
export async function readRtcResult(ctx: AgentContext, handle: string, now = new Date()) {
  if (!HANDLE.test(handle)) throw new Error("RTC_RESULT_NOT_FOUND");
  const result = await prisma.agentResult.findUnique({
    where: { digest: DIGEST(handle) },
    include: { connection: { select: { userId: true, revokedAt: true, kind: true } } },
  });
  if (!result || result.connectionId !== ctx.connectionId ||
      result.connection.userId !== ctx.userId ||
      result.connection.kind !== "PASS" || result.connection.revokedAt ||
      result.expiresAt <= now)
    throw new Error("RTC_RESULT_NOT_FOUND");
  const stillAuthorized = await prisma.agentPass.findFirst({
    where: { connectionId: ctx.connectionId, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true },
  });
  if (!stillAuthorized) throw new Error("RTC_RESULT_NOT_FOUND");
  return result.payload;
}
