import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { twoFactorEnrollmentRequired } from "@/domains/security/two-factor";
import { grantedMcpScopes, MCP_SCOPES, type McpScope } from "@/mcp/scopes";
import type { AgentContext } from "./authorization";

const PREFIX = "rtc_pass_";
const PASS = /^rtc_pass_[A-Za-z0-9_-]{43}$/;
const MS_DAY = 86_400_000;
const digest = (secret: string) => createHash("sha256").update(secret).digest("hex");

export function isRtcPass(value: string): boolean { return PASS.test(value); }

/** A real secret must never be returned in an API listing, audit log or URL. */
export function newRtcPassSecret(): string {
  return PREFIX + randomBytes(32).toString("base64url");
}

export async function issueRtcPass(ownerId: string, input: {
  label: string; scopes: McpScope[]; expiresDays?: number; areas?: string[];
}, now = new Date()) {
  const days = input.expiresDays ?? 1;
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw new Error("INVALID_RTC_PASS_DURATION");
  const label = input.label.trim();
  if (label.length < 3 || label.length > 80 || /[\x00-\x1f]/.test(label))
    throw new Error("INVALID_RTC_PASS_LABEL");
  const unique = [...new Set(input.scopes)];
  if (!unique.length || unique.some(scope => !MCP_SCOPES.includes(scope)))
    throw new Error("INVALID_RTC_PASS_SCOPES");
  const validAreas = ["health", "automation", "configuration", "backup", "decisions",
    "feedback", "repair", "optimization"] as const;
  const areas = [...new Set(input.areas ?? [])];
  if (areas.length > validAreas.length || areas.some(area =>
      !validAreas.includes(area as (typeof validAreas)[number])))
    throw new Error("INVALID_RTC_PASS_AREAS");
  const secret = newRtcPassSecret();
  const d = digest(secret);
  const connectionClientId = "rtc-pass:" + randomUUID();
  const expiresAt = new Date(now.getTime() + days * MS_DAY);
  const created = await prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, ownerId, ["OWNER"]);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: ownerId }, select: { role: true },
    });
    if (await twoFactorEnrollmentRequired(ownerId, user.role))
      throw new Error("TWO_FACTOR_REQUIRED");
    const connection = await tx.mcpConnection.create({
      data: { userId: ownerId, oauthClientId: connectionClientId, kind: "PASS",
        label, scopes: unique },
    });
    const pass = await tx.agentPass.create({
      data: { connectionId: connection.id, digest: d, label, scopes: unique,
        areas, profile: "read_only", allowWrites: false, allowProduction: false,
        expiresAt },
    });
    await tx.auditLog.create({ data: {
      userId: ownerId, action: "rtc.pass.created", entityType: "AgentPass",
      entityId: pass.id, newValue: { expiresAt: expiresAt.toISOString(),
        scopes: unique, label },
    } });
    return { id: pass.id, connectionId: connection.id };
  });
  // One-time display to the authenticated owner action only. Never persist the value.
  return { ...created, secret, expiresAt };
}

export async function revokeRtcPass(ownerId: string, passId: string) {
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, ownerId, ["OWNER"]);
    const pass = await tx.agentPass.findUnique({ where: { id: passId },
      include: { connection: { select: { userId: true } } } });
    if (!pass || pass.connection.userId !== ownerId) throw new Error("RTC_PASS_NOT_FOUND");
    if (!pass.revokedAt) {
      await tx.agentPass.update({ where: { id: passId }, data: { revokedAt: new Date() } });
      await tx.mcpConnection.update({ where: { id: pass.connectionId },
        data: { revokedAt: new Date(), revokedReason: "Pass revoked by owner" } });
      await tx.auditLog.create({ data: { userId: ownerId, action: "rtc.pass.revoked",
        entityType: "AgentPass", entityId: pass.id, newValue: { revoked: true } } });
    }
    return { revoked: true };
  });
}

/** Same DB-backed limit for all server instances, never in-memory counters. */
export async function authenticateRtcPass(request: Request): Promise<AgentContext | Response> {
  const reject = (code: "permission" | "pass_revoked" | "pass_expired" | "rate_limited" = "permission",
    status = 401) => Response.json({
      ok: false, error: { code, what: "RTC pass not accepted",
        cause: code === "rate_limited" ? "Too many requests" : "Pass is unavailable or lacks access",
        todo: "Check or renew the owner's RTC pass", technical: "" },
    }, { status, headers: { "Cache-Control": "no-store",
      ...(status === 429 ? { "Retry-After": "60" } : { "WWW-Authenticate": "Bearer" }) } });
  // Neither URL nor query parameters are ever a credential transport.
  if (/rtc_pass_/i.test(request.url)) return reject();
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer (rtc_pass_[A-Za-z0-9_-]{43})$/.exec(auth);
  if (!match) return reject();
  const d = digest(match[1]);
  const pass = await prisma.agentPass.findUnique({ where: { digest: d }, include: {
    connection: { include: { user: { select: { id: true, name: true, role: true, archivedAt: true } } } },
  } });
  if (!pass) return reject();
  if (pass.revokedAt || pass.connection.revokedAt) return reject("pass_revoked");
  if (pass.expiresAt <= new Date()) return reject("pass_expired");
  if (pass.connection.kind !== "PASS" || pass.connection.user.archivedAt ||
      pass.connection.user.role !== "OWNER" ||
      pass.connection.userId !== pass.connection.user.id ||
      pass.profile !== "read_only" || pass.allowWrites ||
      (process.env.VERCEL_ENV === "production" && !pass.allowProduction))
    return reject();
  if (await twoFactorEnrollmentRequired(pass.connection.userId, "OWNER")) return reject();
  if (await isRateLimited("rtc:" + pass.id, { max: 120, windowMs: 600_000 })) {
    return reject("rate_limited", 429);
  }
  const stillLive = await prisma.agentPass.updateMany({
    where: { id: pass.id, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { lastUsedAt: new Date() },
  });
  if (stillLive.count !== 1) return reject("pass_revoked");
  return {
    userId: pass.connection.userId,
    name: pass.connection.user.name ?? "Owner",
    role: "OWNER",
    connectionId: pass.connectionId,
    connectionLabel: pass.label,
    rtcAreas: pass.areas,
    scopes: grantedMcpScopes(pass.scopes, pass.connection.scopes).filter(
      scope => scope === "ops:read" || scope === "decisions:read",
    ),
  };
}
