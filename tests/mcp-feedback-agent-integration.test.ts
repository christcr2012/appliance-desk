import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/domains/agent-control/authorization";
import { previewAgentOperation, executeAgentOperation } from "@/domains/agent-control/operations";
import { previewFeedbackMutation } from "@/domains/feedback/agent-actions";
import { getFeedbackForAgent } from "@/domains/feedback/agent";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && !process.env.VERCEL &&
  url.pathname === "/appliance_desk_test" && ["localhost", "127.0.0.1"].includes(url.hostname);

describe.skipIf(!enabled)("MCP-11 journaled app feedback on disposable PostgreSQL", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const ownerId = "fb-ai-owner-" + tag;
  const reporterId = "fb-ai-reporter-" + tag;
  const connectionId = "fb-ai-connection-" + tag;
  const ctx: AgentContext = {
    userId: ownerId, name: "Test assistant owner", role: "OWNER",
    connectionId, connectionLabel: "Synthetic feedback assistant",
    scopes: ["feedback:triage", "feedback:content"],
  };
  const key = (n: number) => "feedback-ai-action-" + tag + "-" + n;
  let reportId = "";
  const preview = (n: number, action: "FEEDBACK_REPLY" | "FEEDBACK_UPDATE" | "FEEDBACK_LINK_CASE",
    args: Record<string, unknown>) => previewAgentOperation(ctx, { action, args, requestKey: key(n) });
  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerId, name: "Test owner", email: ownerId + "@example.test", role: "OWNER" },
      { id: reporterId, name: "Test reporter", email: reporterId + "@example.test", role: "CUSTOMER" },
    ] });
    await prisma.mcpConnection.create({ data: {
      id: connectionId, userId: ownerId, oauthClientId: connectionId,
      label: "Feedback test agent", scopes: ctx.scopes,
    } });
    const report = await prisma.feedbackReport.create({ data: {
      reporterUserId: reporterId, reporterRole: "CUSTOMER", kind: "BUG",
      title: "Synthetic app issue", description: "Save does not respond.",
      routeTemplate: "/account/feedback", safeContext: {}, requestKey: key(0),
      aiReview: "ALLOWED",
    } });
    reportId = report.id;
  });
  afterAll(async () => {
    await prisma.feedbackCaseLink.deleteMany({ where: { reportId } });
    await prisma.feedbackEntry.deleteMany({ where: { reportId } });
    await prisma.feedbackEvent.deleteMany({ where: { reportId } });
    await prisma.feedbackReport.deleteMany({ where: { id: reportId } });
    await prisma.auditLog.deleteMany({ where: { userId: ownerId,
      entityType: { in: ["AgentOperation", "FeedbackReport"] } } });
    await prisma.agentOperation.deleteMany({ where: { connectionId } });
    await prisma.mcpConnection.deleteMany({ where: { id: connectionId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, reporterId] } } });
    await prisma.$disconnect();
  });

  it("blocks execution after reporter withdrawal; no entry appears", async () => {
    const created = await preview(1, "FEEDBACK_REPLY", {
      reportId, expectedVersion: 1, visibility: "REPORTER", body: "We are reviewing this.",
    });
    expect(created.state).toBe("PREVIEWED");
    await prisma.feedbackReport.update({
      where: { id: reportId }, data: { aiReview: "WITHDRAWN", version: { increment: 1 } },
    });
    const effect = await executeAgentOperation(ctx, { previewId: created.previewId, requestKey: key(1) });
    expect(effect.state).not.toBe("SUCCEEDED");
    expect(await prisma.feedbackEntry.count({ where: { reportId } })).toBe(0);
    await prisma.feedbackReport.update({ where: { id: reportId },
      data: { aiReview: "ALLOWED", version: 1 } });
  });

  it("one journal operation makes exactly one AI-attributed reporter reply after retries", async () => {
    const created = await preview(2, "FEEDBACK_REPLY", {
      reportId, expectedVersion: 1, visibility: "REPORTER", body: "We reproduced your issue.",
    });
    const attempts = await Promise.all(Array.from({ length: 6 }, () =>
      executeAgentOperation(ctx, { previewId: created.previewId, requestKey: key(2) })));
    expect(attempts.every(result => ["RUNNING","SUCCEEDED"].includes(result.state))).toBe(true);
    const entries = await prisma.feedbackEntry.findMany({ where: { reportId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.authorKind).toBe("ASSISTANT");
    expect(entries[0]?.agentConnectionId).toBe(connectionId);
    expect(entries[0]?.visibility).toBe("REPORTER");
    const read = await getFeedbackForAgent(ctx, reportId);
    expect(read.report?.entries.find(e => e.id === entries[0]?.id)?.body).toBe("We reproduced your issue.");
  });

  it("internal note never appears in a reporter-visible entry query", async () => {
    const created = await preview(3, "FEEDBACK_REPLY", {
      reportId, expectedVersion: 2, visibility: "INTERNAL", body: "Private triage evidence.",
    });
    const effect = await executeAgentOperation(ctx, { previewId: created.previewId, requestKey: key(3) });
    expect(effect.state).toBe("SUCCEEDED");
    const all = await prisma.feedbackEntry.findMany({ where: { reportId } });
    expect(all).toHaveLength(2);
    expect(all.filter(e => e.visibility === "REPORTER").map(e => e.body))
      .not.toContain("Private triage evidence.");
  });

  it("cannot mark a report fixed without a linked VERIFIED repair case", async () => {
    await prisma.feedbackReport.update({ where: { id: reportId },
      data: { state: "AWAITING_VERIFICATION", version: 4 } });
    await expect(previewFeedbackMutation(ctx, { kind: "STATE", reportId,
      expectedVersion: 4, toState: "RESOLVED", reason: "Confirmed with owner" }))
      .rejects.toThrow("VERIFIED_REPAIR_REQUIRED");
  });

  it("revoked connection blocks new preview even while the owner is active", async () => {
    await prisma.mcpConnection.update({ where: { id: connectionId },
      data: { revokedAt: new Date() } });
    await expect(preview(5, "FEEDBACK_REPLY", {
      reportId, expectedVersion: 4, visibility: "INTERNAL", body: "No more access",
    })).rejects.toThrow();
  });
});
