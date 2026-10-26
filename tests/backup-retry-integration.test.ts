import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runAutomation } from "@/domains/automation/runs";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("MCP-2 backup claims (throwaway PostgreSQL)", () => {
  const ownerId = "mcp2-owner-" + randomUUID();
  const staffId = "mcp2-staff-" + randomUUID();
  const ids: string[] = [];
  const now = new Date("2040-05-16T12:00:00.000Z");
  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId, email: ownerId + "@example.test", role: "OWNER" } });
    await prisma.user.create({ data: { id: staffId, email: staffId + "@example.test", role: "STAFF" } });
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "AutomationRun", entityId: { in: ids } } });
    await prisma.automationRun.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
  });

  it("two owner requests with different IDs start exactly one manual backup", async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const work = vi.fn(async () => { entered(); await wait; return { counts: { verified: 1 } }; });
    const first = runAutomation({
      ruleKey: "backup-manual", now, actorUserId: ownerId,
      runKeyOverride: "manual:" + randomUUID(), work,
    });
    await started;
    const second = await runAutomation({
      ruleKey: "backup-manual", now, actorUserId: ownerId,
      runKeyOverride: "manual:" + randomUUID(), work,
    });
    release();
    const result = await first;
    if (result.runId) ids.push(result.runId);
    expect(result.outcome).toBe("RAN");
    expect(second.outcome).toBe("ALREADY_RAN");
    expect(work).toHaveBeenCalledTimes(1);
    const audit = await prisma.auditLog.findFirst({ where: { action: "backup.manual_run", entityId: result.runId! } });
    expect(audit?.userId).toBe(ownerId);
    const repeated = await runAutomation({ruleKey:"backup-manual",now,actorUserId:ownerId,
      runKeyOverride:"manual:"+randomUUID(),work});
    expect(repeated.outcome).toBe("ALREADY_RAN");
  });

  it("a nightly backup claim is refused while manual backup holds the lock", async () => {
    // Test on a different synthetic Colorado date, so the previous test's completed
    // manual run does not interfere.
    const later = new Date("2040-05-17T12:00:00.000Z");
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const first = runAutomation({ruleKey:"backup-manual",actorUserId:ownerId,
      runKeyOverride:"manual:"+randomUUID(),now:later,
      work:async()=>{entered();await wait;return {counts:{verified:1}};}});
    await started;
    const blocked = await runAutomation({ruleKey:"backup",now:later,
      work:async()=>{throw new Error("Should not begin while manual backup is running");}});
    release();
    const success = await first;
    if(success.runId)ids.push(success.runId);
    expect(success.outcome).toBe("RAN");
    expect(blocked.outcome).toBe("ALREADY_RAN");
    expect(blocked.runId).toBeNull();
  });

  it("staff cannot initiate a manual backup or write an audit row", async () => {
    const attempt = "manual:" + randomUUID();
    await expect(runAutomation({ruleKey:"backup-manual",actorUserId:staffId,
      runKeyOverride:attempt,now:new Date("2040-05-18T12:00:00.000Z"),
      work:async()=>({counts:{}})})).rejects.toThrow(/no longer has access/i);
    expect(await prisma.automationRun.findFirst({where:{ruleKey:"backup-manual",runKey:attempt}})).toBeNull();
  });
});
