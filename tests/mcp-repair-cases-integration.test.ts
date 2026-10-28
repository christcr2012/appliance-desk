import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createRepairCase, linkRepairPullRequest, checkRepairCase, stopRepairCase, listRepairCases,
} from "@/domains/agent-control/repair-cases";

const actorId = "mcp-repair-user-" + randomUUID();
const issueId = "mcp-repair-issue-" + randomUUID();
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
  });

  afterAll(async () => {
    await prisma.repairCase.deleteMany({ where: { sourceId: issueId } });
    await prisma.systemIssue.deleteMany({ where: { id: issueId } });
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

  it("lets the owner decline an unverified repair, preserving issue history", async () => {
    const record = await createRepairCase(input());
    const result = await stopRepairCase(actorId, record.id, "REJECTED", "No longer applicable");
    expect(result.stage).toBe("REJECTED");
    expect((await listRepairCases(actorId)).some(r => r.id === record.id)).toBe(true);
    expect((await prisma.systemIssue.findUniqueOrThrow({ where: { id: issueId } })).status).toBe("OPEN");
  });
});
