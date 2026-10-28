import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createRepairCase, linkRepairPullRequest, checkRepairCase, stopRepairCase, listRepairCases,
} from "@/domains/agent-control/repair-cases";

const actorId = "mcp-repair-user-" + randomUUID();
const issueId = "mcp-repair-issue-" + randomUUID();
const transitionId = "mcp-repair-evidence-" + randomUUID();
const feedbackReporterId = "mcp-repair-reporter-" + randomUUID();
let feedbackReportId = "";
const revision = "a".repeat(40);
const originalRevision = process.env.VERCEL_GIT_COMMIT_SHA;

describe("MCP-6 disposable PostgreSQL repair cases", () => {
  beforeAll(async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = revision;
    await prisma.user.create({ data: { id: actorId, name: "Repair test owner",
      role: "OWNER", email: actorId + "@example.test" } });
    await prisma.systemIssue.create({ data: {
      id: issueId, fingerprint: "repair-fixture:" + issueId, kind: "AUTOMATION_FAILED",
      severity: "MEDIUM", summary: "Scheduled inspection failed", detail: "Safe diagnostic test issue",
    } });
    await prisma.systemIssue.create({ data: {
      id: transitionId, fingerprint: "automation:backup", kind: "AUTOMATION_FAILED",
      severity: "MEDIUM", summary: "Another scheduled inspection failed", detail: "Synthetic check case",
    } });
  });

  beforeAll(async () => {
    await prisma.user.create({ data: { id: feedbackReporterId,
      email: `${feedbackReporterId}@example.test`, role: "CUSTOMER",
      name: "Synthetic reporter" } });
    const report = await prisma.feedbackReport.create({ data: {
      reporterUserId: feedbackReporterId, reporterRole: "CUSTOMER", kind: "BUG",
      title: "Synthetic opted-in issue", description: "Synthetic malfunction",
      routeTemplate: "/account", safeContext: {},
      requestKey: feedbackReporterId.slice(0, 60), aiReview: "HUMAN_ONLY",
    } });
    feedbackReportId = report.id;
  });

  afterAll(async () => {
    await prisma.repairCase.deleteMany({ where: { sourceId: feedbackReportId } });
    await prisma.feedbackReport.delete({ where: { id: feedbackReportId } });
    await prisma.user.delete({ where: { id: feedbackReporterId } });
    await prisma.repairCase.deleteMany({ where: { sourceId: { in: [issueId, transitionId] } } });
    await prisma.systemIssue.deleteMany({ where: { id: { in: [issueId, transitionId] } } });
    await prisma.automationRun.deleteMany({ where: { runKey: transitionId } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    if (originalRevision === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = originalRevision;
    await prisma.$disconnect();
  });

  const input = () => ({
    actorId, sourceKind: "SYSTEM_ISSUE" as const, sourceId: issueId,
    expectedBehavior: "The scheduled inspection should finish successfully.",
    howToCheck: "automation:backup",
  });

  it("keeps exactly one active case under differently worded concurrent requests", async () => {
    const records = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      createRepairCase({ ...input(), expectedBehavior:
        `The scheduled inspection should complete successfully, request ${i}.` })));
    expect(new Set(records.map(record => record.id)).size).toBe(1);
    expect(await prisma.repairCase.count({ where: {
      sourceKind: "SYSTEM_ISSUE", sourceId: issueId,
      stage: { notIn: ["VERIFIED", "REJECTED", "SUPERSEDED"] },
    } })).toBe(1);
  });

  it("requires explicit feedback AI consent and rechecks withdrawn or deleted consent", async () => {
    const reportInput = { actorId, sourceKind: "FEEDBACK" as const,
      sourceId: feedbackReportId, expectedBehavior: "The screen loads correctly",
      howToCheck: "Owner verifies the corrected screen" };
    await expect(createRepairCase(reportInput)).rejects
      .toMatchObject({ code: "REPORT_HAS_NO_AGENT_PERMISSION" });
    await prisma.feedbackReport.update({ where: { id: feedbackReportId },
      data: { aiReview: "ALLOWED" } });
    const record = await createRepairCase(reportInput);
    expect(record.sourceKind).toBe("FEEDBACK");
    expect(record.sourceId).toBe(feedbackReportId);
    await prisma.feedbackReport.update({ where: { id: feedbackReportId },
      data: { aiReview: "WITHDRAWN" } });
    await expect(createRepairCase(reportInput)).rejects
      .toMatchObject({ code: "REPORT_HAS_NO_AGENT_PERMISSION" });
    await expect(linkRepairPullRequest({ actorId, caseId: record.id, prNumber: 704 }))
      .rejects.toMatchObject({ code: "REPORT_HAS_NO_AGENT_PERMISSION" });
    await prisma.feedbackReport.update({ where: { id: feedbackReportId },
      data: { aiReview: "ALLOWED" } });
    await linkRepairPullRequest({ actorId, caseId: record.id, prNumber: 704 });
    await prisma.feedbackReport.update({ where: { id: feedbackReportId },
      data: { aiReview: "WITHDRAWN" } });
    let evidenceCalls = 0;
    const blocked = await checkRepairCase(actorId, record.id, { fetcher: async () => {
      evidenceCalls++;
      throw new Error("GitHub must never be called after consent withdrawal");
    } });
    expect(blocked?.stage).toBe("BLOCKED");
    expect(blocked?.blocker).toBe("REPORT_HAS_NO_AGENT_PERMISSION");
    expect(evidenceCalls).toBe(0);
    await prisma.feedbackReport.update({ where: { id: feedbackReportId },
      data: { aiReview: "ALLOWED", contentRemovedAt: new Date() } });
    await expect(createRepairCase(reportInput)).rejects
      .toMatchObject({ code: "REPORT_HAS_NO_AGENT_PERMISSION" });
  });

  it("rejects invented sources and personal information", async () => {
    await expect(createRepairCase({ ...input(), sourceId: "unknown" })).rejects
      .toMatchObject({ code: "REPAIR_SOURCE_NOT_FOUND" });
    await expect(createRepairCase({ ...input(), expectedBehavior: "Call test@example.com" })).rejects
      .toMatchObject({ code: "REPAIR_TEXT_CONTAINS_PRIVATE_DATA" });
    await expect(createRepairCase({ ...input(), howToCheck: "claimed-success" })).rejects
      .toMatchObject({ code: "REPAIR_REQUIRES_NAMED_AUTOMATION_CHECK" });
  });

  it("deduplicates concurrent repair submissions to one durable case", async () => {
    const records = await Promise.all(Array.from({ length: 8 }, () => createRepairCase(input())));
    expect(new Set(records.map(r => r.id)).size).toBe(1);
    expect(await prisma.repairCase.count({ where: { sourceId: issueId } })).toBe(1);
    expect(records[0].baselineRevision).toBe(revision);
    expect(records[0].sourceVersion).toBe(1);
  });

  it("does not accept foreign repository evidence or fabricated PRs", async () => {
    const record = await createRepairCase(input());
    await expect(linkRepairPullRequest({ actorId, caseId: record.id, prNumber: 31,
      repository: "some-other-owner/repo" })).rejects.toMatchObject({ code: "FOREIGN_REPOSITORY" });
    await linkRepairPullRequest({ actorId, caseId: record.id, prNumber: 987654321 });
    const check = await checkRepairCase(actorId, record.id, {
      fetcher: async () => new Response(null, { status: 404 }),
    });
    expect(check?.stage).toBe("BLOCKED");
    expect(check?.verifiedAt).toBeNull();
    expect((await prisma.systemIssue.findUniqueOrThrow({ where: { id: issueId } })).status).toBe("OPEN");
  });

  it("separates open, merged, deployed and independently checked evidence", async () => {
    const record = await createRepairCase({ ...input(), sourceId: transitionId });
    const prNumber = 61;
    const mergeSha = "b".repeat(40);
    const liveSha = "c".repeat(40);
    await linkRepairPullRequest({ actorId, caseId: record.id, prNumber });
    let merged = false;
    let ciPassed = false;
    let ancestry = false;
    const fetcher = async (request: RequestInfo | URL) => {
      const path = new URL(String(request)).pathname;
      let result: object;
      if (path.endsWith(`/pulls/${prNumber}`)) {
        result = { number: prNumber, state: merged ? "closed" : "open", base: { ref: "main" },
          head: { repo: { full_name: "christcr2012/appliance-desk" } },
          merged_at: merged ? "2026-10-28T00:00:00Z" : null,
          merge_commit_sha: merged ? mergeSha : null };
      } else if (path.endsWith(`/commits/${mergeSha}/check-runs`)) {
        result = { check_runs: ciPassed ? [{ name: "ci", status: "completed",
          conclusion: "success", head_sha: mergeSha }] : [] };
      } else if (path.endsWith(`/compare/${mergeSha}...${liveSha}`)) {
        result = { status: ancestry ? "ahead" : "behind" };
      } else {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify(result), { status: 200,
        headers: { "content-type": "application/json" } });
    };
    expect((await checkRepairCase(actorId, record.id, { fetcher }))?.stage).toBe("PR_OPEN");
    merged = true;
    expect((await checkRepairCase(actorId, record.id, { fetcher }))?.stage).toBe("PR_OPEN");
    ciPassed = true;
    expect((await checkRepairCase(actorId, record.id, {
      fetcher, deployedRevision: "unverified" }))?.stage).toBe("MERGED");
    expect((await checkRepairCase(actorId, record.id, {
      fetcher, deployedRevision: liveSha }))?.stage).toBe("MERGED");
    ancestry = true;
    const deployed = await checkRepairCase(actorId, record.id, { fetcher, deployedRevision: liveSha });
    expect(deployed?.stage).toBe("DEPLOYED");
    expect(deployed?.verifiedAt).toBeNull();
    const deployment = await prisma.repairEvidence.findFirstOrThrow({
      where: { caseId: record.id, kind: "DEPLOYMENT", status: "VERIFIED" },
      orderBy: { checkedAt: "desc" },
    });
    await prisma.systemIssue.update({ where: { id: transitionId }, data: { status: "RESOLVED" } });
    await prisma.automationRun.create({ data: { ruleKey: "backup", runKey: transitionId,
      environment: "test", state: "SUCCEEDED",
      startedAt: new Date(deployment.checkedAt!.getTime() + 1000) } });
    // A matching success from an unrelated rule must never claim this repair fixed.
    await prisma.systemIssue.update({ where: { id: transitionId },
      data: { fingerprint: "automation:unrelated-inspection" } });
    const unlinked = await checkRepairCase(actorId, record.id, { fetcher, deployedRevision: liveSha });
    expect(unlinked?.stage).toBe("DEPLOYED");
    expect(unlinked?.blocker).toBe("REPAIR_CHECK_NOT_LINKED_TO_SOURCE");
    await prisma.systemIssue.update({ where: { id: transitionId },
      data: { fingerprint: "automation:backup" } });
    const checked = await checkRepairCase(actorId, record.id, { fetcher, deployedRevision: liveSha });
    expect(checked?.stage).toBe("VERIFIED");
    expect(checked?.verifiedAt).toBeTruthy();
  });

  it("lets the owner decline an unverified repair, preserving issue history", async () => {
    const record = await createRepairCase(input());
    const result = await stopRepairCase(actorId, record.id, "REJECTED", "No longer applicable");
    expect(result.stage).toBe("REJECTED");
    expect((await listRepairCases(actorId)).some(r => r.id === record.id)).toBe(true);
    expect((await prisma.systemIssue.findUniqueOrThrow({ where: { id: issueId } })).status).toBe("OPEN");
  });
});
