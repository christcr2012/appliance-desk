import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canonicalAgentArgs, createJournalPreview, decideJournalApproval } from "@/domains/agent-control/journal";
import type { AgentContext } from "@/domains/agent-control/authorization";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && !process.env.VERCEL &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("MCP action journal on disposable PostgreSQL", () => {
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const adminId = "mcp-journal-admin-" + nonce;
  const ownerId = "mcp-journal-owner-" + nonce;
  const connectionId = "mcp-journal-connection-" + nonce;
  const ctx: AgentContext = {
    userId: adminId, name: "Journal admin", role: "ADMIN", connectionId,
    connectionLabel: "Journal test assistant",
    scopes: ["ops:read", "ops:maintain", "decisions:read", "decisions:apply"],
  };
  const initial = {
    tool: "appliance_action_preview",
    action: "RETRY_DATABASE_BACKUP" as const,
    targetRef: "backup",
    args: { action: "retry", expected: { runs: 2, values: ["safe", "safe"] } },
    requestKey: "journal-request-safe-001",
    previewHash: "a".repeat(64),
    preview: { summary: "Retry the database backup", changes: [{
      label: "Backup", now: "Failed", after: "Try again once",
    }] },
  };

  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: adminId, name: "Journal admin", role: "ADMIN", email: adminId + "@example.test" },
      { id: ownerId, name: "Journal owner", role: "OWNER", email: ownerId + "@example.test" },
    ] });
    await prisma.mcpConnection.create({ data: {
      id: connectionId, userId: adminId, oauthClientId: connectionId,
      label: "MCP journal test", scopes: ctx.scopes,
    } });
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [adminId, ownerId] }, entityType: "AgentOperation" },
    });
    await prisma.agentOperation.deleteMany({ where: { connectionId } });
    await prisma.mcpConnection.deleteMany({ where: { id: connectionId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, ownerId] } } });
    await prisma.$disconnect();
  });

  it("canonicalizes argument order and never changes a request key's meaning", () => {
    expect(canonicalAgentArgs({ b: 2, a: { z: false, x: "yes" } }).digest)
      .toBe(canonicalAgentArgs({ a: { x: "yes", z: false }, b: 2 }).digest);
    expect(() => canonicalAgentArgs({ long: "x".repeat(65_540) })).toThrow("ACTION_ARGUMENT_TOO_LARGE");
    expect(() => canonicalAgentArgs({ bad: undefined })).toThrow("INVALID_ACTION_ARGUMENT");
    expect(() => canonicalAgentArgs({ bad: Number.POSITIVE_INFINITY })).toThrow("INVALID_ACTION_ARGUMENT");
  });

  it("serializes 20 concurrent previews into one operation and rejects changed args", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => createJournalPreview(ctx, initial)));
    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    const result = results[0]!;
    expect(result.state).toBe("AWAITING_APPROVAL");
    expect(result.attempt).toBe(0);
    expect(result.startedAt).toBeNull();
    expect(await prisma.agentOperation.count({ where: { connectionId, tool: initial.tool } })).toBe(1);
    await expect(createJournalPreview(ctx, {
      ...initial, args: { action: "not-the-same" },
    })).rejects.toThrow("CONFLICT");
  });

  it("requires an active OWNER to approve or decline and refuses a second approval", async () => {
    const row = await createJournalPreview(ctx, initial);
    await expect(decideJournalApproval(adminId, row.id, true)).rejects.toThrow();
    const accepted = await decideJournalApproval(ownerId, row.id, true);
    expect(accepted.state).toBe("AUTHORIZED");
    await expect(decideJournalApproval(ownerId, row.id, false)).rejects.toThrow("INVALID_APPROVAL_STATE");

    const declined = await createJournalPreview(ctx, { ...initial, requestKey: "journal-request-safe-002" });
    const result = await decideJournalApproval(ownerId, declined.id, false);
    expect(result.state).toBe("DENIED");
  });

  it("rejects disconnected, unscoped or archived assistants before creating another preview", async () => {
    await prisma.mcpConnection.update({ where: { id: connectionId }, data: { revokedAt: new Date() } });
    await expect(createJournalPreview(ctx, { ...initial, requestKey: "journal-request-safe-003" }))
      .rejects.toThrow("CONNECTION_REVOKED");
    await prisma.mcpConnection.update({ where: { id: connectionId }, data: {
      revokedAt: null, scopes: ["ops:read"],
    } });
    await expect(createJournalPreview(ctx, { ...initial, requestKey: "journal-request-safe-004" }))
      .rejects.toThrow("FORBIDDEN_SCOPE");
    await prisma.mcpConnection.update({ where: { id: connectionId }, data: { scopes: ctx.scopes } });
    const pending = await createJournalPreview(ctx, {
      ...initial, requestKey: "journal-request-safe-006",
    });
    await prisma.user.update({ where: { id: adminId }, data: { role: "STAFF" } });
    await expect(decideJournalApproval(ownerId, pending.id, true)).rejects.toThrow();
    await prisma.user.update({ where: { id: adminId }, data: { role: "ADMIN" } });
    await prisma.user.update({ where: { id: adminId }, data: { archivedAt: new Date() } });
    await expect(createJournalPreview(ctx, { ...initial, requestKey: "journal-request-safe-005" }))
      .rejects.toThrow();
  });
});
