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
