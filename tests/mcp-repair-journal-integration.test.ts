import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { previewAgentOperation, executeAgentOperation } from "@/domains/agent-control/operations";
import { decideJournalApproval } from "@/domains/agent-control/journal";
import type { AgentContext } from "@/domains/agent-control/authorization";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && !process.env.VERCEL &&
  ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("MCP-6 journaled repairs on disposable PostgreSQL", () => {
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const ownerId = `repair-journal-owner-${nonce}`;
  const connectionId = `repair-journal-connection-${nonce}`;
  const sourceId = `repair-journal-source-${nonce}`;
  const key = (n: number) => `repair-journal-request-${nonce}-${n}`;
  const ctx: AgentContext = { userId: ownerId, name: "Repair owner", role: "OWNER",
    connectionId, connectionLabel: "Repair test assistant", scopes: ["ops:read", "repairs:write"] };
  const args = { sourceKind: "SYSTEM_ISSUE", sourceId,
    expectedBehavior: "Backup finishes successfully", howToCheck: "automation:backup" };
  const previousRevision = process.env.VERCEL_GIT_COMMIT_SHA;
  beforeAll(async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "f".repeat(40);
    await prisma.user.create({ data: { id: ownerId, name: "Repair owner", role: "OWNER",
      email: `${ownerId}@example.test` } });
    await prisma.mcpConnection.create({ data: { id: connectionId, userId: ownerId,
      oauthClientId: connectionId, label: "Repair test", scopes: ctx.scopes } });
    await prisma.systemIssue.create({ data: { id: sourceId,
      fingerprint: `repair-journal:${nonce}`, kind: "AUTOMATION_FAILED",
      severity: "MEDIUM", summary: "Backup failed", detail: "Synthetic issue" } });
  });

  afterAll(async () => {
    await prisma.repairCase.deleteMany({ where: { sourceId } });
    await prisma.systemIssue.deleteMany({ where: { id: sourceId } });
    const ops = await prisma.agentOperation.findMany({ where: { connectionId }, select: { id: true } });
    await prisma.staffTask.deleteMany({ where: { createdByUserId: ownerId,
      sourceKey: { startsWith: "assistant-action:" } } });
    await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
    await prisma.systemIssue.deleteMany({ where: {
      fingerprint: { in: ops.map(op => "assistant-action:" + op.id) },
    } });
    await prisma.agentOperation.deleteMany({ where: { connectionId } });
    await prisma.mcpConnection.delete({ where: { id: connectionId } });
    await prisma.user.delete({ where: { id: ownerId } });
    if (previousRevision === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = previousRevision;
    await prisma.$disconnect();
  });
  let caseId = "";
  it("requires owner approval, then creates exactly once and verifies storage", async () => {
    const requestKey = key(1);
    const preview = await previewAgentOperation(ctx, {
      action: "REPAIR_CREATE_CASE", args, requestKey,
    });
    expect(preview.approval).toBe("OWNER_IN_APP");
    expect(preview.state).toBe("AWAITING_APPROVAL");
    expect(await prisma.repairCase.count({ where: { sourceId } })).toBe(0);
    await expect(executeAgentOperation(ctx, { previewId: preview.previewId, requestKey }))
      .rejects.toThrow("OWNER_APPROVAL_REQUIRED");
    await decideJournalApproval(ownerId, preview.previewId, true);
    const done = await executeAgentOperation(ctx, { previewId: preview.previewId, requestKey });
    expect(done.state).toBe("SUCCEEDED");
    caseId = String((done.safeResult as { caseId?: string } | null)?.caseId);
    expect(caseId).toBeTruthy();
    const record = await prisma.repairCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(record.sourceId).toBe(sourceId);
    expect(record.baselineRevision).toBe("f".repeat(40));
    const replay = await executeAgentOperation(ctx, { previewId: preview.previewId, requestKey });
    expect(replay.state).toBe("SUCCEEDED");
    expect(await prisma.repairCase.count({ where: { sourceId } })).toBe(1);
  });
  it("records candidate evidence; a failed GitHub read never claims a fix", async () => {
    const linkKey = key(2);
    const proposed = await previewAgentOperation(ctx, {
      action: "REPAIR_LINK_EVIDENCE", args: { caseId, kind: "PR", ref: "704" }, requestKey: linkKey,
    });
    expect(proposed.approval).toBe("OWNER_IN_APP");
    await decideJournalApproval(ownerId, proposed.previewId, true);
    const linked = await executeAgentOperation(ctx, { previewId: proposed.previewId, requestKey: linkKey });
    expect(linked.state).toBe("SUCCEEDED");
    expect(await prisma.repairEvidence.count({ where: { caseId,
      kind: "PR", status: "CANDIDATE" } })).toBe(1);
    const checkKey = key(3);
    const check = await previewAgentOperation(ctx, {
      action: "REPAIR_CHECK_CASE", args: { caseId }, requestKey: checkKey,
    });
    await decideJournalApproval(ownerId, check.previewId, true);
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 404 });
    try {
      const result = await executeAgentOperation(ctx, { previewId: check.previewId, requestKey: checkKey });
      expect(result.state).toBe("SUCCEEDED"); // The evidence check completed, not the repair.
      const record = await prisma.repairCase.findUniqueOrThrow({ where: { id: caseId } });
      expect(record.stage).toBe("BLOCKED");
      expect(record.verifiedAt).toBeNull();
      expect((await prisma.systemIssue.findUniqueOrThrow({ where: { id: sourceId } })).status).toBe("OPEN");
    } finally { globalThis.fetch = fetchBefore; }
  });
  it("rejects a removed repair grant before owner approval or dispatch", async () => {
    const requestKey = key(4);
    const pending = await previewAgentOperation(ctx, {
      action: "REPAIR_CREATE_CASE", args, requestKey,
    });
    await prisma.mcpConnection.update({ where: { id: connectionId },
      data: { scopes: ["ops:read"] } });
    try {
      await expect(decideJournalApproval(ownerId, pending.previewId, true))
        .rejects.toThrow("FORBIDDEN_SCOPE");
      await expect(executeAgentOperation(ctx, { previewId: pending.previewId, requestKey }))
        .rejects.toThrow("FORBIDDEN_SCOPE");
    } finally {
      await prisma.mcpConnection.update({ where: { id: connectionId },
        data: { scopes: ctx.scopes } });
    }
  });
});
