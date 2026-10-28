import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/domains/agent-control/authorization";

const fake = vi.hoisted(() => ({
  hash: "a".repeat(64), calls: 0, throwAfterEffect: false,
}));
vi.mock("@/domains/agent-control/actions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domains/agent-control/actions")>();
  const { prisma: db } = await import("@/lib/prisma");
  return {
    ...original,
    prepareAgentAction: vi.fn(async (_ctx: unknown, _action: string, args: Record<string, unknown>) => ({
      args, targetRef: "test-target",
      preview: { summary: "Check one safe test action", changes: [{
        label: "Test state", now: "Not checked", after: "Checked",
      }] }, previewHash: fake.hash, verifyIntent: { marker: "test-target" },
    })),
    dispatchAgentAction: vi.fn(async (_ctx: unknown, _action: string, _args: unknown, operationId: string) => {
      fake.calls++;
      await db.auditLog.create({ data: {
        userId: null, action: "mcp.test_effect", entityType: "AgentOperation", entityId: operationId,
        newValue: { complete: true },
      } });
      if (fake.throwAfterEffect) throw new Error("Response lost AFTER the business effect");
      return { completed: true };
    }),
    verifyAgentAction: vi.fn(async (_ctx: unknown, _action: string, _intent: unknown, operationId: string) => {
      const count = await db.auditLog.count({ where: {
        action: "mcp.test_effect", entityType: "AgentOperation", entityId: operationId,
      } });
      return { ok: count === 1, observed: { appliedCount: count } };
    }),
  };
});

import {
  previewAgentOperation, executeAgentOperation, getAgentOperation, reconcileAgentOperations,
} from "@/domains/agent-control/operations";
import { decideJournalApproval } from "@/domains/agent-control/journal";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && !process.env.VERCEL &&
  ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("MCP actions execute once on disposable PostgreSQL", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const userId = "mcp-exec-owner-" + suffix;
  const connectionId = "mcp-exec-connection-" + suffix;
  const ctx: AgentContext = {
    userId, name: "Test owner", role: "OWNER", connectionId,
    connectionLabel: "Test assistant", scopes: ["ops:read", "ops:maintain", "decisions:read", "decisions:apply"],
  };
  const key = (n: number) => "execute-request-" + suffix + "-" + String(n).padStart(3, "0");
  async function preview(n: number, action: "RUN_DIAGNOSTIC_SWEEP" | "RETRY_DATABASE_BACKUP" = "RUN_DIAGNOSTIC_SWEEP") {
    return previewAgentOperation(ctx, { action, args: {}, requestKey: key(n) });
  }

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, name: "Test owner", role: "OWNER",
      email: userId + "@example.test" } });
    await prisma.mcpConnection.create({ data: {
      id: connectionId, userId, oauthClientId: connectionId,
      label: "Test assistant", scopes: ctx.scopes,
    } });
  });
  beforeEach(() => {
    fake.hash = "a".repeat(64);
    fake.calls = 0;
    fake.throwAfterEffect = false;
  });
  afterAll(async () => {
    const ids = await prisma.agentOperation.findMany({ where: { connectionId }, select: { id: true } });
    await prisma.staffTask.deleteMany({ where: { createdByUserId: userId,
      sourceKey: { startsWith: "assistant-action:" } } });
    await prisma.auditLog.deleteMany({ where: { OR: [
      { userId, entityType: "AgentOperation" },
      { userId, entityType: "StaffTask" },
      { action: "mcp.test_effect", entityId: { in: ids.map((op) => op.id) } },
    ] } });
    await prisma.systemIssue.deleteMany({ where: {
      fingerprint: { in: ids.map((op) => "assistant-action:" + op.id) },
    } });
    await prisma.agentOperation.deleteMany({ where: { connectionId } });
    await prisma.mcpConnection.delete({ where: { id: connectionId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("20 simultaneous executions and later retries dispatch one actual effect", async () => {
    const created = await preview(1);
    const outcomes = await Promise.all(Array.from({ length: 20 }, () =>
      executeAgentOperation(ctx, { previewId: created.previewId, requestKey: key(1) })));
    expect(fake.calls).toBe(1);
    expect(outcomes.every(({ state }) => state === "RUNNING" || state === "SUCCEEDED")).toBe(true);
    const final = await getAgentOperation(ctx, created.previewId);
    expect(final.state).toBe("SUCCEEDED");
    const replay = await executeAgentOperation(ctx, { previewId: created.previewId, requestKey: key(1) });
    expect(replay.state).toBe("SUCCEEDED");
    expect(fake.calls).toBe(1);
    const row = await prisma.agentOperation.findUniqueOrThrow({ where: { id: created.previewId } });
    expect(row.attempt).toBe(1);
  });

  it("requires an owner approval for storage effects; no command runs first", async () => {
    const created = await preview(2, "RETRY_DATABASE_BACKUP");
    expect(created.state).toBe("AWAITING_APPROVAL");
    await expect(executeAgentOperation(ctx, {
      previewId: created.previewId, requestKey: key(2),
    })).rejects.toThrow("OWNER_APPROVAL_REQUIRED");
    expect(fake.calls).toBe(0);
    const approved = await decideJournalApproval(userId, created.previewId, true);
    expect(approved.state).toBe("AUTHORIZED");
    const done = await executeAgentOperation(ctx, { previewId: created.previewId, requestKey: key(2) });
    expect(done.state).toBe("SUCCEEDED");
    expect(fake.calls).toBe(1);
  });

  it("expires the preview when the target changes; never dispatches", async () => {
    const created = await preview(3);
    fake.hash = "b".repeat(64);
    const result = await executeAgentOperation(ctx, { previewId: created.previewId, requestKey: key(3) });
    expect(result.state).toBe("EXPIRED");
    expect(result.failureCode).toBe("PREVIEW_CHANGED");
    expect(fake.calls).toBe(0);
  });

  it("disconnect or role downgrade before execution denies the effect", async () => {
    const disconnected = await preview(4);
    await prisma.mcpConnection.update({ where: { id: connectionId }, data: { revokedAt: new Date() } });
    await expect(executeAgentOperation(ctx, {
      previewId: disconnected.previewId, requestKey: key(4),
    })).rejects.toThrow("CONNECTION_REVOKED");
    await prisma.mcpConnection.update({ where: { id: connectionId }, data: { revokedAt: null } });
    const downgraded = await preview(5);
    await prisma.user.update({ where: { id: userId }, data: { role: "STAFF" } });
    await expect(executeAgentOperation(ctx, {
      previewId: downgraded.previewId, requestKey: key(5),
    })).rejects.toThrow();
    await prisma.user.update({ where: { id: userId }, data: { role: "OWNER" } });
    expect(fake.calls).toBe(0);
  });

  it("expires stale previews and refuses denied requests", async () => {
    const expired = await preview(6);
    await prisma.agentOperation.update({ where: { id: expired.previewId },
      data: { expiresAt: new Date(Date.now() - 1000) } });
    const result = await executeAgentOperation(ctx, { previewId: expired.previewId, requestKey: key(6) });
    expect(result.state).toBe("EXPIRED");
    const denied = await preview(7, "RETRY_DATABASE_BACKUP");
    await decideJournalApproval(userId, denied.previewId, false);
    await expect(executeAgentOperation(ctx, {
      previewId: denied.previewId, requestKey: key(7),
    })).resolves.toMatchObject({ state: "DENIED" });
    expect(fake.calls).toBe(0);
  });

  it("reconciles an effect after its response was lost, without replaying", async () => {
    const created = await preview(8);
    fake.throwAfterEffect = true;
    const uncertain = await executeAgentOperation(ctx, {
      previewId: created.previewId, requestKey: key(8),
    });
    expect(uncertain.state).toBe("UNKNOWN");
    expect(fake.calls).toBe(1);
    const after = await reconcileAgentOperations(new Date(), 30);
    expect(after.recovered).toBeGreaterThanOrEqual(1);
    const latest = await getAgentOperation(ctx, created.previewId);
    expect(latest.state).toBe("SUCCEEDED");
    expect(fake.calls).toBe(1);
  });
});
