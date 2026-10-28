import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/domains/agent-control/authorization";

const fake = vi.hoisted(() => ({
  hash: "a".repeat(64), calls: 0, throwAfterEffect: false,
  dispatchWait: null as Promise<void> | null, releaseDispatch: null as (() => void) | null,
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
      if (fake.dispatchWait) await fake.dispatchWait;
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
import { operationBackupRunKey } from "@/domains/backup/manual";

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
    fake.dispatchWait = null;
    fake.releaseDispatch = null;
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

  it("uses an exact stable UUID-shaped manual backup idempotency key", () => {
    const id = "cmcp5backup0123456789safe";
    const first = operationBackupRunKey(id);
    expect(first).toMatch(/^manual:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
    expect(operationBackupRunKey(id)).toBe(first);
    expect(operationBackupRunKey("cmcp5backup9876543210safe")).not.toBe(first);
    expect(() => operationBackupRunKey("arbitrary-user-key")).toThrow("INVALID_OPERATION_ID");
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

  it("a disconnected and renewed grant cannot execute or approve an old preview", async () => {
    const old = await preview(14, "RETRY_DATABASE_BACKUP");
    const original = await prisma.mcpConnection.findUniqueOrThrow({ where: { id: connectionId } });
    await prisma.mcpConnection.update({ where: { id: connectionId }, data: {
      revokedAt: new Date(), grantVersion: randomUUID(),
    } });
    await prisma.mcpConnection.update({ where: { id: connectionId }, data: { revokedAt: null } });
    try {
      await expect(decideJournalApproval(userId, old.previewId, true))
        .rejects.toThrow("CONNECTION_REVOKED");
      await expect(executeAgentOperation(ctx, { previewId: old.previewId, requestKey: key(14) }))
        .rejects.toThrow("CONNECTION_REVOKED");
      await expect(preview(14, "RETRY_DATABASE_BACKUP")).rejects.toThrow("CONNECTION_REVOKED");
      expect(fake.calls).toBe(0);
    } finally {
      await prisma.mcpConnection.update({ where: { id: connectionId },
        data: { grantVersion: original.grantVersion } });
    }
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

  it("fences the stale worker before readback and refuses any second dispatch", async () => {
    const created = await preview(9);
    fake.dispatchWait = new Promise<void>((resolve) => { fake.releaseDispatch = resolve; });
    try {
      const executing = executeAgentOperation(ctx, {
        previewId: created.previewId, requestKey: key(9),
      });
      await expect.poll(async () => (await prisma.agentOperation.findUniqueOrThrow({
        where: { id: created.previewId }, select: { state: true },
      })).state, { timeout: 15000 }).toBe("RUNNING");
      await prisma.agentOperation.update({ where: { id: created.previewId },
        data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
      const check = await reconcileAgentOperations(new Date(), 30);
      expect(check.uncertain).toBeGreaterThanOrEqual(1);
      expect((await prisma.agentOperation.findUniqueOrThrow({
        where: { id: created.previewId },
      })).state).toBe("UNKNOWN");
      fake.releaseDispatch?.();
      const stale = await executing;
      expect(stale.state).toBe("UNKNOWN");
      expect(fake.calls).toBe(1);
      const recovered = await reconcileAgentOperations(new Date(), 30);
      expect(recovered.recovered).toBeGreaterThanOrEqual(1);
      expect((await getAgentOperation(ctx, created.previewId)).state).toBe("SUCCEEDED");
      expect(fake.calls).toBe(1);
    } finally {
      fake.releaseDispatch?.();
    }
  });

  it("rotates past ten permanently uncertain actions to reconcile a later success", async () => {
    const now = new Date();
    for (let n = 30; n < 40; n++) {
      const item = await preview(n);
      await prisma.agentOperation.update({ where: { id: item.previewId }, data: {
        state: "UNKNOWN", startedAt: now, verifyIntent: undefined,
      } });
      // JSON null marks absent recovery evidence; these cannot be reconciled.
      await prisma.agentOperation.update({ where: { id: item.previewId }, data: {
        verifyIntent: (await import("@prisma/client")).Prisma.DbNull,
      } });
    }
    const next = await preview(40);
    await prisma.agentOperation.update({ where: { id: next.previewId }, data: {
      state: "UNKNOWN", startedAt: now, verifyIntent: { marker: "test-target" },
    } });
    await prisma.auditLog.create({ data: {
      userId: null, action: "mcp.test_effect", entityType: "AgentOperation",
      entityId: next.previewId, newValue: { complete: true },
    } });
    const first = await reconcileAgentOperations(now, 10);
    expect(first.recovered).toBe(0);
    const second = await reconcileAgentOperations(new Date(now.getTime() + 1000), 10);
    expect(second.recovered).toBeGreaterThanOrEqual(1);
    expect((await prisma.agentOperation.findUniqueOrThrow({
      where: { id: next.previewId },
    })).state).toBe("SUCCEEDED");
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
