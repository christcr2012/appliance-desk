import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import { runMonitors, saveMonitorRule, type MonitorSignal } from "@/domains/agent-control/monitoring";

const id = randomUUID().replaceAll("-", "").slice(0, 22);
const ownerId = "monitor-owner-" + id;
const staffId = "monitor-staff-" + id;
const ruleKey = "open-high-issues";
const issueKey = "monitor:" + ruleKey;
const now = (date: string) => new Date(date);
const failing = async (): Promise<MonitorSignal> => ({ failed: true, detail: "Synthetic failing high-priority check" });
const healthy = async (): Promise<MonitorSignal> => ({ failed: false, detail: "Synthetic resolved check" });

describe("MCP-7 disposable-PostgreSQL monitoring slots", () => {
  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerId, role: "OWNER", name: "Synthetic monitor owner", email: ownerId + "@example.test" },
      { id: staffId, role: "STAFF", name: "Synthetic monitor staff", email: staffId + "@example.test" },
    ] });
  });
  beforeEach(async () => {
    await prisma.monitorRun.deleteMany({ where: { ruleKey } });
    await prisma.monitorRule.deleteMany({ where: { key: ruleKey } });
    await prisma.systemIssue.deleteMany({ where: { fingerprint: issueKey } });
  });
  afterAll(async () => {
    await prisma.monitorRun.deleteMany({ where: { ruleKey } });
    await prisma.monitorRule.deleteMany({ where: { key: ruleKey } });
    await prisma.systemIssue.deleteMany({ where: { fingerprint: issueKey } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await prisma.$disconnect();
  });
  async function enable(failuresBeforeAlert = 2, cooldownHours = 72, notifyEmail = false) {
    await saveMonitorRule(ownerId, {
      key: ruleKey, enabled: true, failuresBeforeAlert, cooldownHours,
      notifyEmail, expectedVersion: null,
    });
  }
  it("claims one slot with two concurrent workers and no duplicate effect", async () => {
    await enable(1);
    const day = now("2026-11-03T18:00:00Z");
    const events: string[] = [];
    const both = await Promise.all(Array.from({ length: 2 }, () =>
      runMonitors(day, { evaluate: failing, notify: async key => { events.push(key); } })));
    expect(both.reduce((n, r) => n + r.checked, 0)).toBe(1);
    expect(both.reduce((n, r) => n + r.alerted, 0)).toBe(1);
    expect(await prisma.monitorRun.count({ where: { ruleKey } })).toBe(1);
    expect(await prisma.systemIssue.count({ where: { fingerprint: issueKey } })).toBe(1);
    expect(events).toEqual([]);
  });
  it("two failures alert once, cooldown keeps one issue, and recovery closes it", async () => {
    await enable();
    const d1 = await runMonitors(now("2026-11-03T18:00:00Z"), { evaluate: failing });
    const d2 = await runMonitors(now("2026-11-04T18:00:00Z"), { evaluate: failing });
    const d3 = await runMonitors(now("2026-11-05T18:00:00Z"), { evaluate: failing });
    const d4 = await runMonitors(now("2026-11-06T18:00:00Z"), { evaluate: healthy });
    expect([d1.alerted,d2.alerted,d3.alerted,d4.recovered]).toEqual([0,1,0,1]);
    const runs = await prisma.monitorRun.findMany({ where: { ruleKey }, orderBy: { slot:"asc" } });
    expect(runs.map(x => x.consecutiveFailures)).toEqual([1,2,3,0]);
    expect(runs.map(x => x.state)).toEqual(["SKIPPED","ALERT","SKIPPED","RECOVERED"]);
    const issue = await prisma.systemIssue.findUniqueOrThrow({ where: { fingerprint: issueKey } });
    expect(issue.status).toBe("RESOLVED");
    expect(issue.occurrences).toBe(1);
  });
  it("email failure never starts a second incident or repeats a sent notification", async () => {
    await enable(1,72,true);
    let attempted = 0;
    const result = await runMonitors(now("2026-11-03T18:00:00Z"), {
      evaluate: failing,
      notify: async () => { attempted++; throw new Error("Provider intentionally unavailable"); },
    });
    expect(result.alerted).toBe(1);
    expect(attempted).toBe(1);
    const receipt = await prisma.monitorRun.findUniqueOrThrow({
      where: { ruleKey_slot: { ruleKey, slot: "2026-11-03" } },
    });
    expect(receipt.emailErrorCode).toBe("OWNER_EMAIL_NOT_SENT");
    await runMonitors(now("2026-11-04T18:00:00Z"), { evaluate: failing,
      notify: async () => { attempted++; } });
    expect(attempted).toBe(1);
    expect(await prisma.systemIssue.count({ where: { fingerprint: issueKey } })).toBe(1);
  });
  it("owner-only settings preserve optimistic version checks and revocation", async () => {
    await expect(saveMonitorRule(staffId, {
      key: ruleKey, enabled:true, failuresBeforeAlert:1, cooldownHours:24,
      notifyEmail:false,expectedVersion:null,
    })).rejects.toThrow("no longer has access");
    await enable();
    const row = await prisma.monitorRule.findUniqueOrThrow({ where: { key: ruleKey } });
    await saveMonitorRule(ownerId, {
      key: ruleKey, enabled:false, failuresBeforeAlert:2, cooldownHours:24,
      notifyEmail:false, expectedVersion:row.version,
    });
    await expect(saveMonitorRule(ownerId, {
      key: ruleKey, enabled:true, failuresBeforeAlert:2, cooldownHours:24,
      notifyEmail:false, expectedVersion:row.version,
    })).rejects.toThrow("changed");
    const result = await runMonitors(now("2026-11-03T18:00:00Z"), { evaluate: failing });
    expect(result.checked).toBe(0);
    expect(await prisma.monitorRun.count({ where: { ruleKey } })).toBe(0);
  });
  it("two UTC instants across the fall-back hour map to one Colorado daily slot", async () => {
    await enable(1);
    const first = now("2026-11-01T07:30:00Z");
    const second = now("2026-11-01T08:30:00Z");
    expect(businessDateKey(first)).toBe("2026-11-01");
    expect(businessDateKey(second)).toBe("2026-11-01");
    await runMonitors(first, { evaluate: failing });
    await runMonitors(second, { evaluate: failing });
    expect(await prisma.monitorRun.count({ where: { ruleKey } })).toBe(1);
  });
});
