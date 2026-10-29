import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import type { AgentContext } from "@/domains/agent-control/authorization";
import { previewAgentOperation, executeAgentOperation } from "@/domains/agent-control/operations";
import { prepareAgentAction, verifyAgentAction } from "@/domains/agent-control/actions";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && !process.env.VERCEL &&
  ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("MCP-5 executes real DEC-1 answers with readback", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const connectionId = "mcp-dec-connection-" + tag;
  const actorId = "mcp-dec-owner-" + tag;
  const rdf = "IN-37-RDF-OWED";
  const other = "TRUSTED-DEVICE-DAYS";
  const ctx: AgentContext = {
    userId: actorId, name: "Test owner", role: "OWNER", connectionId,
    connectionLabel: "DEC-1 test assistant",
    scopes: ["ops:maintain", "decisions:read", "decisions:apply"],
  };
  let original: string;

  beforeAll(async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    original = settings.retailDeliveryFeeDecision;
    await prisma.user.create({ data: { id: actorId, name: "DEC-1 test owner", role: "OWNER",
      email: actorId + "@example.test" } });
    await prisma.mcpConnection.create({ data: { id: connectionId, userId: actorId,
      oauthClientId: connectionId, label: ctx.connectionLabel, scopes: ctx.scopes } });
  });
  beforeEach(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" },
      data: { retailDeliveryFeeDecision: "UNDECIDED" } });
    if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32)
      process.env.BETTER_AUTH_SECRET = "ci-only-local-postgres-mcp-test-not-live";
  });
  afterAll(async () => {
    const operations = await prisma.agentOperation.findMany({ where: { connectionId },
      select: { id: true } });
    await prisma.decisionScheduledChange.deleteMany({ where: {
      decisionRecordId: { in: (await prisma.decisionRecord.findMany({
        where: { answeredByUserId: actorId }, select: { id: true },
      })).map((r) => r.id) },
    } });
    await prisma.decisionRecord.deleteMany({ where: { answeredByUserId: actorId } });
    await prisma.auditLog.deleteMany({ where: { OR: [
      { userId: actorId },
      { entityType: "AgentOperation", entityId: { in: operations.map((r) => r.id) } },
    ] } });
    await prisma.agentOperation.deleteMany({ where: { connectionId } });
    await prisma.mcpConnection.delete({ where: { id: connectionId } });
    await prisma.businessSettings.update({ where: { id: "singleton" },
      data: { retailDeliveryFeeDecision: original } });
    await prisma.user.delete({ where: { id: actorId } });
    await prisma.$disconnect();
  });

  it("never changes a setting at preview; applies the exact answer and an Other record once", async () => {
    const requestKey = "dec1-current-" + tag;
    const answers = [
      { code: "DQ-" + rdf, option: "NOT_LIABLE", answeredBy: "Test CPA", firm: "Fictional",
        explanation: "Synthetic sample", answeredOn: businessDateKey(new Date()) },
      { code: "DQ-" + other, option: null, otherText: "Needs further legal review", answeredBy: "Test CPA" },
    ];
    const prepared = await previewAgentOperation(ctx, {
      action: "APPLY_DECISION_ANSWERS", args: { answers }, requestKey,
    });
    expect(prepared.state).toBe("PREVIEWED");
    expect((await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
    })).retailDeliveryFeeDecision).toBe("UNDECIDED");
    const result = await executeAgentOperation(ctx, {
      previewId: prepared.previewId, requestKey,
    });
    expect(result).toMatchObject({ state: "SUCCEEDED" });
    expect((await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
    })).retailDeliveryFeeDecision).toBe("NOT_LIABLE");
    const answer = await prisma.decisionRecord.findFirstOrThrow({ where: {
      subjectId: rdf, answeredByUserId: actorId, via: "MCP", kind: "PROFESSIONAL_ANSWER",
    } });
    expect(answer.value).toBe("NOT_LIABLE");
    const otherRecord = await prisma.decisionRecord.findFirstOrThrow({ where: {
      subjectId: other, answeredByUserId: actorId, via: "MCP", kind: "PROFESSIONAL_ANSWER",
    } });
    expect(otherRecord.value).toBeNull();
    expect((await executeAgentOperation(ctx, {
      previewId: prepared.previewId, requestKey,
    })).state).toBe("SUCCEEDED");
    expect(answer.agentOperationId).toBe(prepared.previewId);
    expect(otherRecord.agentOperationId).toBe(prepared.previewId);
    const expected = await prepareAgentAction(ctx, "APPLY_DECISION_ANSWERS", { answers });
    const startedAt = new Date(Date.now() - 60_000);
    const matching = await verifyAgentAction(ctx, "APPLY_DECISION_ANSWERS",
      expected.verifyIntent, prepared.previewId, startedAt, null);
    expect(matching.ok).toBe(true);
    const differentOperation = await verifyAgentAction(ctx, "APPLY_DECISION_ANSWERS",
      expected.verifyIntent, "unrelated-never-dispatched", startedAt, null);
    expect(differentOperation.ok).toBe(false);
    const tampered = structuredClone(expected.verifyIntent);
    (tampered.answers as { expectedValue: string }[])[0]!.expectedValue = "LIABLE";
    expect((await verifyAgentAction(ctx, "APPLY_DECISION_ANSWERS",
      tampered, prepared.previewId, startedAt, null)).ok).toBe(false);
    expect(await prisma.decisionRecord.count({ where: { answeredByUserId: actorId } })).toBe(2);
  });

  it("a future answer passes through scheduled-change readback without activating early", async () => {
    const requestKey = "dec1-future-" + tag;
    const future = businessDateKey(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
    const prepared = await previewAgentOperation(ctx, {
      action: "APPLY_DECISION_ANSWERS", requestKey, args: {
        answers: [{ code: rdf, option: "NOT_LIABLE", effectiveFrom: future, answeredBy: "Test CPA" }],
      },
    });
    const result = await executeAgentOperation(ctx, {
      previewId: prepared.previewId, requestKey,
    });
    expect(result.state).toBe("SUCCEEDED");
    expect((await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
    })).retailDeliveryFeeDecision).toBe("UNDECIDED");
    const record = await prisma.decisionRecord.findFirstOrThrow({
      where: { subjectId: rdf, answeredByUserId: actorId, via: "MCP", effectiveFrom: { not: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const scheduled = await prisma.decisionScheduledChange.findFirstOrThrow({ where: {
      subjectId: rdf, decisionRecordId: record.id,
    } });
    expect(scheduled.value).toBe("NOT_LIABLE");
    expect(businessDateKey(scheduled.effectiveFrom)).toBe(future);
    expect(scheduled.appliedAt).toBeNull();
  });

  it("refuses edited journal arguments even when the preview hash exists", async () => {
    const requestKey = "dec1-tamper-" + tag;
    const prepared = await previewAgentOperation(ctx, {
      action: "APPLY_DECISION_ANSWERS", requestKey, args: {
        answers: [{ code: rdf, option: "NOT_LIABLE", answeredBy: "Test CPA" }],
      },
    });
    await prisma.agentOperation.update({ where: { id: prepared.previewId },
      data: { args: { answers: [{ code: rdf, option: "COLLECT", answeredBy: "Test CPA" }] } } });
    await expect(executeAgentOperation(ctx, {
      previewId: prepared.previewId, requestKey,
    })).rejects.toThrow("OPERATION_ARGUMENT_TAMPERED");
    expect((await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
    })).retailDeliveryFeeDecision).toBe("UNDECIDED");
  });
});
