import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordSystemIssue, resolveSystemIssue } from "@/domains/system-issues";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" && ["localhost", "127.0.0.1"].includes(url.hostname);
const unique = () => randomUUID().replaceAll("-", "");
const failed = (key: string) => ({
  kind: "AUTOMATION_FAILED" as const, ruleKey: key, runId: "run-" + unique(),
  startedAt: new Date("2026-10-08T20:00:00Z"), errorName: "TimeoutError",
  errorCode: "ETIMEDOUT",
});

describe.skipIf(!enabled)("S-1A system issue records on throwaway Postgres", () => {
  beforeEach(async () => {
    await prisma.systemIssueNote.deleteMany({where:{issue:{fingerprint:"automation:backup"}}});
    await prisma.systemIssue.deleteMany({where:{fingerprint:"automation:backup"}});
  });
  it("concurrent upsert dedupes one fingerprint and preserves both occurrences", async () => {
    const ruleKey = "backup";
    await Promise.all([recordSystemIssue(failed(ruleKey)), recordSystemIssue(failed(ruleKey))]);
    const found = await prisma.systemIssue.findMany({ where: { fingerprint: "automation:" + ruleKey } });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ status: "OPEN", occurrences: 2, version: 2, kind: "AUTOMATION_FAILED" });
  });
  it("a resolved issue reopens, clears resolution, increments version and can resolve again", async () => {
    const ruleKey = "backup";
    const fingerprint = "automation:" + ruleKey;
    await recordSystemIssue(failed(ruleKey));
    await resolveSystemIssue(fingerprint, "SOURCE_SUCCEEDED");
    const resolved = await prisma.systemIssue.findUniqueOrThrow({ where: { fingerprint } });
    expect(resolved).toMatchObject({ status: "RESOLVED", resolvedReason: "SOURCE_SUCCEEDED", version: 2 });
    await recordSystemIssue(failed(ruleKey));
    const reopened = await prisma.systemIssue.findUniqueOrThrow({ where: { fingerprint } });
    expect(reopened).toMatchObject({ status: "OPEN", resolvedAt: null, resolvedReason: null, occurrences: 2, version: 3 });
    await resolveSystemIssue(fingerprint, "OWNER_REVIEWED");
    await resolveSystemIssue(fingerprint, "OWNER_REVIEWED");
    const final = await prisma.systemIssue.findUniqueOrThrow({ where: { fingerprint } });
    expect(final.status).toBe("RESOLVED");
    expect(final.version).toBe(4); // second resolve is a no-op
  });
  it("writer failure leaves completed business work intact", async () => {
    const ruleKey = "backup";
    const run = await prisma.automationRun.create({
      data: { ruleKey, runKey: ruleKey + ":" + unique(), environment: "test", state: "SUCCEEDED" },
    });
    const spy = vi.spyOn(prisma.systemIssue, "upsert").mockRejectedValueOnce(new Error("simulated inaccessible issue store"));
    try { await expect(recordSystemIssue(failed(ruleKey))).resolves.toBeUndefined(); }
    finally { spy.mockRestore(); }
    expect((await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } })).state).toBe("SUCCEEDED");
    expect(await prisma.systemIssue.findUnique({ where: { fingerprint: "automation:" + ruleKey } })).toBeNull();
  });
  it("rejects an arbitrary official URL rather than storing an untrusted link", async () => {
    const watchId = "watch-" + unique();
    await recordSystemIssue({kind:"SOURCE_PAGE_UNREACHABLE",watchId,officialUrl:"https://untrusted.invalid/",consecutiveFailures:3});
    expect(await prisma.systemIssue.findFirst({where:{fingerprint:"source-page:"+watchId}})).toBeNull();
  });
  it("keeps note authors exclusive and enforces the two-kilobyte storage limit", async () => {
    const key = "backup";
    await recordSystemIssue(failed(key));
    const issue = await prisma.systemIssue.findUniqueOrThrow({where:{fingerprint:"automation:"+key}});
    await expect(prisma.systemIssueNote.create({data:{
      issueId:issue.id,authorUserId:"staff",authorKeyId:"agent",body:"safe",
    }})).rejects.toThrow();
    await expect(prisma.systemIssueNote.create({data:{
      issueId:issue.id,body:"x".repeat(2049),
    }})).rejects.toThrow();
    const note = await prisma.systemIssueNote.create({data:{
      issueId:issue.id,authorUserId:"staff",body:"Check the automation configuration.",
    }});
    expect(note.issueId).toBe(issue.id);
  });
  it("preserves the database allowlist and occurrence check", async () => {
    const fingerprint = "invalid-" + unique();
    await expect(prisma.systemIssue.create({data:{
      fingerprint,kind:"CUSTOMER_ADDRESS",severity:"LOW",summary:"bad",detail:"bad",
    }})).rejects.toThrow();
    expect(await prisma.systemIssue.findUnique({where:{fingerprint}})).toBeNull();
  });
});
