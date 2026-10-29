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
const connectionId = "monitor-connection-" + id;
const now = (date: string) => new Date(date);
const failing = async (): Promise<MonitorSignal> => ({ failed: true, detail: "Synthetic failing high-priority check" });
const healthy = async (): Promise<MonitorSignal> => ({ failed: false, detail: "Synthetic resolved check" });

describe("MCP-7 disposable-PostgreSQL monitoring slots", () => {
  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerId, role: "OWNER", name: "Synthetic monitor owner", email: ownerId + "@example.test" },
      { id: staffId, role: "STAFF", name: "Synthetic monitor staff", email: staffId + "@example.test" },
    ] });
    await prisma.mcpConnection.create({ data: {
      id: connectionId, userId: ownerId, oauthClientId: "monitor-client-" + id,
      label: "Synthetic maintenance connection", scopes: ["ops:maintain"],
    } });
  });
  beforeEach(async () => {
    await prisma.monitorRun.deleteMany({ where: { ruleKey } });
    await prisma.monitorRule.deleteMany({ where: { key: ruleKey } });
    await prisma.agentOperation.deleteMany({ where: { connectionId } });
    await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
    await prisma.mcpConnection.update({ where: { id: connectionId }, data: { revokedAt: null, scopes: ["ops:maintain"] } });
    await prisma.systemIssue.deleteMany({ where: { fingerprint: issueKey } });
  });
  afterAll(async () => {
    await prisma.monitorRun.deleteMany({ where: { ruleKey } });
    await prisma.monitorRule.deleteMany({ where: { key: ruleKey } });
    await prisma.systemIssue.deleteMany({ where: { fingerprint: issueKey } });
    await prisma.agentOperation.deleteMany({ where: { connectionId } });
    // Journal and standing-rule grants create audit entries with a restrictive
    // User foreign key; remove synthetic test evidence before its synthetic owner.
    await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
    await prisma.mcpConnection.delete({ where: { id: connectionId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await prisma.$disconnect();
  });
  async function enable(failuresBeforeAlert = 2, cooldownHours = 72, notifyEmail = false) {
    await saveMonitorRule(ownerId, {
      key: ruleKey, enabled: true, failuresBeforeAlert, cooldownHours,
      notifyEmail, expectedVersion: null,
    });
  }
  async function grantDiagnostic() {
    await saveMonitorRule(ownerId, {
      key: ruleKey, enabled: true, failuresBeforeAlert: 1, cooldownHours: 24,
      notifyEmail: false, expectedVersion: null,
      autoAction: "RUN_DIAGNOSTIC_SWEEP", autoActionConnectionId: connectionId,
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
  it("keeps an acknowledged incident active for cooldown and recovery", async () => {
    await enable(1, 72);
    await runMonitors(now("2026-11-03T18:00:00Z"), { evaluate: failing });
    await prisma.systemIssue.update({
      where: { fingerprint: issueKey }, data: { status: "ACKNOWLEDGED" },
    });
    const next = await runMonitors(now("2026-11-04T18:00:00Z"), { evaluate: failing });
    expect(next.alerted).toBe(0);
    const recovered = await runMonitors(now("2026-11-05T18:00:00Z"), { evaluate: healthy });
    expect(recovered.recovered).toBe(1);
    expect((await prisma.systemIssue.findUniqueOrThrow({
      where: { fingerprint: issueKey },
    })).status).toBe("RESOLVED");
  });
  it("times overdue feedback from its latest customer response, not the original report", async () => {
    const feedbackKey = "feedback-waiting-3-days";
    const reportId = "monitor-feedback-" + id;
    await prisma.monitorRule.create({ data: {
      key: feedbackKey, enabled: true, failuresBeforeAlert: 1,
    } });
    await prisma.feedbackReport.create({ data: {
      id: reportId, reporterUserId: ownerId, reporterRole: "OWNER",
      kind: "BUG", title: "Test only", description: "Synthetic feedback",
      routeTemplate: "/desk/today", safeContext: {}, requestKey: "monitor-" + id,
      createdAt: now("2026-10-01T18:00:00Z"),
    } });
    try {
      await prisma.feedbackReport.update({ where: { id: reportId }, data: {
        updatedAt: now("2026-11-05T18:00:00Z"),
      } });
      await runMonitors(now("2026-11-06T18:00:00Z"));
      const first = await prisma.monitorRun.findUniqueOrThrow({
        where: { ruleKey_slot: { ruleKey: feedbackKey, slot: "2026-11-06" } },
      });
      expect(first.state).toBe("OK");
      await runMonitors(now("2026-11-10T18:00:00Z"));
      const late = await prisma.monitorRun.findUniqueOrThrow({
        where: { ruleKey_slot: { ruleKey: feedbackKey, slot: "2026-11-10" } },
      });
      expect(late.state).toBe("ALERT");
    } finally {
      await prisma.monitorRun.deleteMany({ where: { ruleKey: feedbackKey } });
      await prisma.monitorRule.deleteMany({ where: { key: feedbackKey } });
      await prisma.systemIssue.deleteMany({ where: { fingerprint: "monitor:" + feedbackKey } });
      await prisma.feedbackReport.deleteMany({ where: { id: reportId } });
    }
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
  });  it("only the owner can grant an active maintenance connection", async () => {
    await expect(saveMonitorRule(staffId, {
      key: ruleKey, enabled: true, failuresBeforeAlert: 1, cooldownHours: 24,
      notifyEmail: false, expectedVersion: null,
      autoAction: "RUN_DIAGNOSTIC_SWEEP", autoActionConnectionId: connectionId,
    })).rejects.toThrow();
    await grantDiagnostic();
    const rule = await prisma.monitorRule.findUniqueOrThrow({ where: { key: ruleKey } });
    expect(rule.autoAction).toBe("RUN_DIAGNOSTIC_SWEEP");
    expect(rule.autoActionConnectionId).toBe(connectionId);
    const grant = await prisma.auditLog.findFirst({ where: {
      userId: ownerId, action: "mcp.monitor.standing_approval",
      entityType: "MonitorRule", entityId: rule.id,
    } });
    expect(grant).toBeTruthy();
    await prisma.mcpConnection.update({ where: { id: connectionId }, data: { revokedAt: new Date() } });
    await expect(saveMonitorRule(ownerId, {
      key: ruleKey, enabled: true, failuresBeforeAlert: 1, cooldownHours: 24,
      notifyEmail: false, expectedVersion: rule.version,
      autoAction: "RUN_DIAGNOSTIC_SWEEP", autoActionConnectionId: connectionId,
    })).rejects.toThrow("no longer authorized");
  });
  it("two workers link at most one MCP-5 operation to one Denver slot", async () => {
    await grantDiagnostic();
    const day = now("2026-11-03T18:00:00Z");
    const both = await Promise.all([
      runMonitors(day, { evaluate: failing }),
      runMonitors(day, { evaluate: failing }),
    ]);
    expect(both.reduce((n, row) => n + row.alerted, 0)).toBe(1);
    const run = await prisma.monitorRun.findUniqueOrThrow({
      where: { ruleKey_slot: { ruleKey, slot: "2026-11-03" } },
    });
    expect(run.operationId).toBeTruthy();
    expect(await prisma.agentOperation.count({ where: { id: run.operationId! } })).toBe(1);
  });
  it("connection revocation after preview prevents dispatch", async () => {
    await grantDiagnostic();
    await runMonitors(now("2026-11-03T18:00:00Z"), {
      evaluate: failing,
      beforeDispatch: async () => {
        await prisma.mcpConnection.update({ where: { id: connectionId }, data: { revokedAt: new Date() } });
      },
    });
    const run = await prisma.monitorRun.findUniqueOrThrow({
      where: { ruleKey_slot: { ruleKey, slot: "2026-11-03" } },
    });
    expect(run.operationId).toBeTruthy();
    const operation = await prisma.agentOperation.findUniqueOrThrow({ where: { id: run.operationId! } });
    expect(operation.state).toBe("DENIED");
    expect(operation.attempt).toBe(0);
  });
  it("disabling a rule after preview blocks its linked action", async () => {
    await grantDiagnostic();
    await runMonitors(now("2026-11-03T18:00:00Z"), {
      evaluate: failing,
      beforeDispatch: async () => {
        await prisma.monitorRule.update({ where: { key: ruleKey },
          data: { enabled: false, version: { increment: 1 } } });
      },
    });
    const run = await prisma.monitorRun.findUniqueOrThrow({
      where: { ruleKey_slot: { ruleKey, slot: "2026-11-03" } },
    });
    const operation = await prisma.agentOperation.findUniqueOrThrow({ where: { id: run.operationId! } });
    expect(operation.state).toBe("DENIED");
    expect(operation.attempt).toBe(0);
  });
});
