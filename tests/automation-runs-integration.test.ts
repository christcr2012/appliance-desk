import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runAutomation } from "@/domains/automation/runs";
import { prisma } from "@/lib/prisma";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("automation runs (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const prefix = `automation-${tag}`;
  const fixedNow = new Date("2026-10-05T18:00:00.000Z");
  let priorPaused: Prisma.JsonValue = [];

  beforeAll(async () => {
    const settings = await prisma.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
      select: { pausedAutomations: true },
    });
    priorPaused = settings.pausedAutomations;
  });

  beforeEach(async () => {
    await prisma.automationRun.deleteMany({ where: { ruleKey: { startsWith: prefix } } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { pausedAutomations: [] } });
  });

  afterAll(async () => {
    await prisma.automationRun.deleteMany({ where: { ruleKey: { startsWith: prefix } } });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { pausedAutomations: priorPaused as Prisma.InputJsonValue },
    });
  });

  it("runs a daily slot once and returns ALREADY_RAN on the second invocation", async () => {
    const ruleKey = `${prefix}-once`;
    const work = vi.fn().mockResolvedValue({ counts: { sent: 2 } });
    const first = await runAutomation({ ruleKey, now: fixedNow, work });
    const second = await runAutomation({ ruleKey, now: fixedNow, work });
    expect(first.outcome).toBe("RAN");
    expect(second.outcome).toBe("ALREADY_RAN");
    expect(work).toHaveBeenCalledTimes(1);
    const rows = await prisma.automationRun.findMany({ where: { ruleKey } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("SUCCEEDED");
    expect(rows[0]?.counts).toEqual({ sent: 2 });
  });

  it("records a sanitized failure and never rethrows it", async () => {
    const ruleKey = `${prefix}-failure`;
    const secret = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMN";
    const result = await runAutomation({
      ruleKey,
      now: fixedNow,
      work: async () => {
        throw new Error(`send failed for customer@example.test using ${secret}`);
      },
    });
    expect(result.outcome).toBe("FAILED");
    const row = await prisma.automationRun.findUniqueOrThrow({ where: { id: result.runId! } });
    expect(row.state).toBe("FAILED");
    expect(row.error).toContain("[email]");
    expect(row.error).toContain("[redacted]");
    expect(row.error).not.toContain("customer@example.test");
    expect(row.error).not.toContain(secret);
  });

  it("MCP-1 canary: a planted secret, email, phone, street address and name never reach any output", async () => {
    // Built at run time so no key-shaped text is committed.
    const secret = ["sk", "live", "canary" + randomUUID().replaceAll("-", "")].join("_");
    const email = `canary-${tag}@example.test`;
    const phone = "(970) 555-0142";
    const street = "4321 Canary Street";
    const person = "Jane Canaryperson";
    const planted = [secret, email, "555-0142", street, person];
    const ruleKey = "expense-drafts"; // a real rule, so the run also records a system issue
    const when = new Date("2025-03-04T18:00:00.000Z"); // a slot no other test uses
    const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER", archivedAt: null }, select: { id: true } });
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
    try {
      const result = await runAutomation({
        ruleKey, now: when,
        work: async () => {
          throw new Error(`upload failed for ${person} at ${street} ${phone} ${email} {"address":"${street}"} using ${secret}`);
        },
      });
      expect(result.outcome).toBe("FAILED");
      const run = await prisma.automationRun.findUniqueOrThrow({ where: { id: result.runId! } });
      expect(run).toMatchObject({ failureCode: "UNCLASSIFIED", failureStage: "work" });
      expect(run.correlationId).toMatch(/^ref-[0-9a-f]{10}$/);
      for (const leaked of [secret, email, "555-0142", street]) expect(run.error).not.toContain(leaked);
      // The server log line carries the same reference and only typed fields.
      const line = logged.find((entry) => entry.includes("[automation]") && entry.includes(run.correlationId!));
      expect(line).toBeDefined();
      for (const leaked of planted) expect(line).not.toContain(leaked);

      const issue = await prisma.systemIssue.findUniqueOrThrow({ where: { fingerprint: "automation:" + ruleKey } });
      expect(issue).toMatchObject({ failureCode: "UNCLASSIFIED", failureStage: "work", correlationId: run.correlationId });
      const { listSystemIssues } = await import("@/domains/system-issues/queries");
      const { getOpsIssues } = await import("@/domains/system-issues/ops-api");
      const { getAutomationHealth } = await import("@/domains/automation/health");
      const dto = (await listSystemIssues(owner.id, { limit: 100 })).rows.find((row) => row.id === issue.id);
      expect(dto?.failure).toMatchObject({ code: "UNCLASSIFIED", reference: run.correlationId });
      const ops = (await getOpsIssues({ limit: 100 })).issues.find((row) => row.id === issue.id);
      expect(ops).toMatchObject({ failureCode: "UNCLASSIFIED" });
      // The legacy check-up key sees the code and its fixed wording only: no stage, reference or raw text.
      expect(ops).not.toHaveProperty("failureStage");
      expect(ops).not.toHaveProperty("correlationId");
      expect(ops).not.toHaveProperty("error");
      const health = (await getAutomationHealth(new Date(when.getTime() + 60_000))).find((row) => row.ruleKey === ruleKey);
      for (const output of [issue, dto, ops, health]) {
        const text = JSON.stringify(output);
        for (const leaked of planted) expect(text, leaked).not.toContain(leaked);
      }
    } finally {
      spy.mockRestore();
      await prisma.systemIssueNote.deleteMany({ where: { issue: { fingerprint: "automation:" + ruleKey } } });
      await prisma.systemIssue.deleteMany({ where: { fingerprint: "automation:" + ruleKey } });
      await prisma.automationRun.deleteMany({ where: { ruleKey, runKey: { startsWith: `${ruleKey}:2025-03-04` } } });
    }
  });

  it("tries a failed slot again later the same day, but only twice", async () => {
    const ruleKey = `${prefix}-failed-retry`;
    let calls = 0;
    const run = () => runAutomation({ ruleKey, now: fixedNow, work: async () => { calls += 1; throw new Error("boom"); } });
    expect((await run()).outcome).toBe("FAILED");
    expect((await run()).outcome).toBe("FAILED");
    expect((await run()).outcome).toBe("FAILED");
    expect((await run()).outcome).toBe("ALREADY_RAN");
    expect(calls).toBe(3);
    const good = `${prefix}-failed-then-ok`;
    await runAutomation({ ruleKey: good, now: fixedNow, work: async () => { throw new Error("once"); } });
    expect((await runAutomation({ ruleKey: good, now: fixedNow, work: async () => ({ counts: {} }) })).outcome).toBe("RAN");
    expect((await runAutomation({ ruleKey: good, now: fixedNow, work: async () => ({ counts: {} }) })).outcome).toBe("ALREADY_RAN");
  });

  it("marks a stale RUNNING row UNKNOWN and performs one retry row", async () => {
    const ruleKey = `${prefix}-stale`;
    const baseRunKey = `${ruleKey}:2026-10-05`;
    const stale = await prisma.automationRun.create({
      data: {
        ruleKey,
        runKey: baseRunKey,
        state: "RUNNING",
        environment: "ci",
        budgetSeconds: 30,
        startedAt: new Date(fixedNow.getTime() - 60_000),
      },
    });
    const work = vi.fn().mockResolvedValue({ counts: { recovered: 1 } });
    const result = await runAutomation({ ruleKey, now: fixedNow, budgetSeconds: 30, work });
    expect(result.outcome).toBe("RAN");
    expect(work).toHaveBeenCalledTimes(1);
    expect((await prisma.automationRun.findUniqueOrThrow({ where: { id: stale.id } })).state).toBe("UNKNOWN");
    const retry = await prisma.automationRun.findUniqueOrThrow({
      where: { ruleKey_runKey: { ruleKey, runKey: `${baseRunKey}:retry1` } },
    });
    expect(retry.state).toBe("SUCCEEDED");
  });

  it("allows exactly one worker to win a concurrent claim", async () => {
    const ruleKey = `${prefix}-concurrent`;
    let calls = 0;
    const work = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { counts: { calls } };
    };
    const results = await Promise.all([
      runAutomation({ ruleKey, now: fixedNow, work }),
      runAutomation({ ruleKey, now: fixedNow, work }),
    ]);
    expect(calls).toBe(1);
    expect(results.map((r) => r.outcome).sort()).toEqual(["ALREADY_RAN", "RAN"]);
    expect(await prisma.automationRun.count({ where: { ruleKey, state: "SUCCEEDED" } })).toBe(1);
  });

  it("writes SKIPPED and does not call work while the owner has paused the rule", async () => {
    const ruleKey = `${prefix}-paused`;
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { pausedAutomations: [ruleKey] } });
    const work = vi.fn().mockResolvedValue({ counts: {} });
    const result = await runAutomation({ ruleKey, now: fixedNow, work });
    expect(result.outcome).toBe("PAUSED");
    expect(work).not.toHaveBeenCalled();
    expect((await prisma.automationRun.findUniqueOrThrow({ where: { id: result.runId! } })).state).toBe("SKIPPED");
  });
});
