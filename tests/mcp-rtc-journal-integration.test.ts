import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const synthetic = vi.hoisted(() => ({ dispatched: 0 }));
vi.mock("@/domains/agent-control/actions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domains/agent-control/actions")>();
  const { prisma: db } = await import("@/lib/prisma");
  return {
    ...original,
    prepareAgentAction: vi.fn(async (_ctx: unknown, _action: string, args: Record<string, unknown>) => ({
      args,
      targetRef: "synthetic-rtc-journal-target",
      preview: {
        summary: "Verify synthetic RTC journal approval",
        changes: [{ label: "Synthetic receipt", now: "Absent", after: "Recorded" }],
      },
      previewHash: "c".repeat(64),
      verifyIntent: { marker: "synthetic-rtc-journal-target" },
    })),
    dispatchAgentAction: vi.fn(async (_ctx: unknown, _action: string, _args: unknown, operationId: string) => {
      synthetic.dispatched++;
      await db.auditLog.create({ data: {
        userId: null, action: "mcp.rtc.synthetic_effect",
        entityType: "AgentOperation", entityId: operationId,
        newValue: { syntheticOnly: true },
      } });
      return { syntheticOnly: true };
    }),
    verifyAgentAction: vi.fn(async (_ctx: unknown, _action: string, _intent: unknown, operationId: string) => {
      const count = await db.auditLog.count({ where: {
        action: "mcp.rtc.synthetic_effect", entityType: "AgentOperation", entityId: operationId,
      } });
      return { ok: count === 1, observed: { appliedCount: count } };
    }),
  };
});

import { prisma } from "@/lib/prisma";
import { issueRtcPass, revokeRtcPass } from "@/domains/agent-control/passes";
import { decideJournalApproval } from "@/domains/agent-control/journal";
import { POST } from "@/app/api/tools/[name]/route";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && !process.env.VERCEL &&
  ["localhost", "127.0.0.1"].includes(database.hostname) &&
  database.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("MCP-9 RTC HTTP writes use real approval and idempotent DB journal", () => {
  const ownerId = "rtc-journal-owner-" + randomUUID();
  const requestKey = "rtc-journal-request-" + randomUUID().replaceAll("-", "");
  let pass: Awaited<ReturnType<typeof issueRtcPass>> | undefined;

  function call(name: string, args: Record<string, unknown>): Promise<Response> {
    if (!pass) throw new Error("Synthetic RTC pass not set up");
    return POST(new Request("http://localhost:3000/api/tools/" + name, {
      method: "POST",
      headers: { authorization: "Bearer " + pass.secret, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    }), { params: Promise.resolve({ name }) });
  }

  beforeAll(async () => {
    await prisma.user.create({ data: {
      id: ownerId, email: ownerId + "@example.test",
      name: "Synthetic RTC journal owner", role: "OWNER", twoFactorEnabled: true,
    } });
    pass = await issueRtcPass(ownerId, {
      label: "Synthetic RTC journal only",
      scopes: ["ops:read", "ops:maintain"],
      areas: ["automation"], allowWrites: true,
    });
  });

  afterAll(async () => {
    if (pass) {
      const operations = await prisma.agentOperation.findMany({
        where: { connectionId: pass.connectionId }, select: { id: true },
      });
      const ids = operations.map((item) => item.id);
      await prisma.staffTask.deleteMany({
        where: { createdByUserId: ownerId, sourceKey: { startsWith: "assistant-action:" } },
      });
      await prisma.auditLog.deleteMany({ where: { OR: [
        { userId: ownerId },
        { action: "mcp.rtc.synthetic_effect", entityId: { in: ids } },
      ] } });
      await prisma.systemIssue.deleteMany({
        where: { fingerprint: { in: ids.map(id => "assistant-action:" + id) } },
      });
      await prisma.agentOperation.deleteMany({ where: { connectionId: pass.connectionId } });
      await prisma.agentPass.deleteMany({ where: { id: pass.id } });
      const digest = createHash("sha256").update("rtc:" + pass.id).digest("hex");
      await prisma.verification.deleteMany({ where: { id: "rate_limit_" + digest } });
      await prisma.mcpConnection.deleteMany({ where: { id: pass.connectionId } });
    }
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
  });

  it("refuses missing confirmations and approvals; dispatches exactly once after owner approval", async () => {
    if (!pass) throw new Error("Synthetic RTC pass not created");
    const args = { action: "RETRY_DATABASE_BACKUP", args: {}, requestKey };

    const unconfirmedPreview = await call("appliance_action_preview", args);
    expect(unconfirmedPreview.status).toBe(200);
    expect(await unconfirmedPreview.json()).toMatchObject({
      ok: true, result: { done: false, needsConfirmation: true },
    });
    expect(await prisma.agentOperation.count({ where: { connectionId: pass.connectionId } })).toBe(0);

    const preview = await call("appliance_action_preview", { ...args, dryRun: true });
    expect(preview.status).toBe(200);
    const previewPayload = await preview.json() as {
      result: { previewId: string; state: string; needsConfirmation: boolean };
    };
    expect(previewPayload.result).toEqual(expect.objectContaining({
      previewId: expect.any(String), state: "AWAITING_APPROVAL", needsConfirmation: true,
    }));
    const previewId = previewPayload.result.previewId;
    expect(await prisma.agentOperation.count({ where: { connectionId: pass.connectionId } })).toBe(1);

    const executeArgs = { previewId, requestKey };
    const unconfirmed = await call("appliance_action_execute", executeArgs);
    expect(unconfirmed.status).toBe(200);
    expect(await unconfirmed.json()).toMatchObject({ result: { done: false, needsConfirmation: true } });
    const preapproval = await call("appliance_action_execute", { ...executeArgs, confirm: true });
    expect(preapproval.status).toBe(403);
    expect((await preapproval.json()).error.code).toBe("refused_by_guard");
    expect(synthetic.dispatched).toBe(0);

    const approved = await decideJournalApproval(ownerId, previewId, true);
    expect(approved.state).toBe("AUTHORIZED");
    const responses = await Promise.all(Array.from({ length: 8 }, () =>
      call("appliance_action_execute", { ...executeArgs, confirm: true })));
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const outcomes = await Promise.all(responses.map(response => response.json()));
    expect(outcomes.every(result => ["RUNNING", "SUCCEEDED"].includes(result.result.state))).toBe(true);

    const recorded = await prisma.agentOperation.findUniqueOrThrow({ where: { id: previewId } });
    expect(recorded.state).toBe("SUCCEEDED");
    expect(recorded.attempt).toBe(1);
    expect(synthetic.dispatched).toBe(1);
    expect(await prisma.auditLog.count({
      where: { action: "mcp.rtc.synthetic_effect", entityId: previewId },
    })).toBe(1);
    const replay = await call("appliance_action_execute", { ...executeArgs, confirm: true });
    expect(replay.status).toBe(200);
    expect((await replay.json()).result.state).toBe("SUCCEEDED");
    expect(synthetic.dispatched).toBe(1);

    await revokeRtcPass(ownerId, pass.id);
    const revoked = await call("appliance_action_execute", { ...executeArgs, confirm: true });
    expect(revoked.status).toBe(401);
    expect((await revoked.json()).error.code).toBe("pass_revoked");
  }, 120_000);
});
