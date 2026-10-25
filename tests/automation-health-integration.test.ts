// MCP-1 spec 3 (bounded reads) and the owner "late" grace setting, on throwaway PostgreSQL.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  RECOMMENDED_LATE_GRACE_MINUTES, getLateGraceMinutes, readRuleRunSummaries, ruleRunSummarySql, saveLateGraceMinutes,
} from "@/domains/automation/health";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("MCP-1 bounded health reads (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const ruleA = `mcp1-a-${tag}`;
  const ruleB = `mcp1-b-${tag}`;
  const now = new Date("2026-06-01T00:00:00Z");
  const start = new Date("2026-01-01T00:00:00Z").getTime();
  const minute = 60_000;

  afterAll(async () => {
    await prisma.automationRun.deleteMany({ where: { ruleKey: { in: [ruleA, ruleB] } } });
  });

  it("reads three rows per rule from 10,000 runs, ties by id, ignores future runs and uses an index", async () => {
    const rows: Prisma.AutomationRunCreateManyInput[] = [];
    for (const ruleKey of [ruleA, ruleB]) {
      for (let i = 0; i < 5000; i += 1) {
        const startedAt = new Date(start + i * minute);
        rows.push({
          ruleKey, runKey: `${ruleKey}:${i}`, environment: "ci", startedAt,
          finishedAt: new Date(startedAt.getTime() + 1000), state: i % 3 === 0 ? "FAILED" : "SUCCEEDED",
          ...(i % 3 === 0 ? { failureCode: "TIMEOUT", failureStage: "work", correlationId: `ref-${i.toString(16).padStart(10, "0")}` } : {}),
        });
      }
    }
    for (let i = 0; i < rows.length; i += 2000) await prisma.automationRun.createMany({ data: rows.slice(i, i + 2000) });
    // Rule A: two runs at the same newest instant; the larger id wins the tie.
    const tie = new Date(start + 6000 * minute);
    await prisma.automationRun.createMany({ data: [
      { id: `${tag}tie0`, ruleKey: ruleA, runKey: `${ruleA}:tie0`, environment: "ci", startedAt: tie, finishedAt: tie, state: "FAILED", failureCode: "DATABASE_BUSY", failureStage: "work", correlationId: "ref-00000000ff" },
      { id: `${tag}tie1`, ruleKey: ruleA, runKey: `${ruleA}:tie1`, environment: "ci", startedAt: tie, finishedAt: tie, state: "SUCCEEDED" },
      // Rule B: a run claiming to start tomorrow is a clock problem and must be ignored.
      { ruleKey: ruleB, runKey: `${ruleB}:future`, environment: "ci", startedAt: new Date(now.getTime() + 86_400_000), state: "FAILED" },
    ] });
    expect(await prisma.automationRun.count({ where: { ruleKey: { in: [ruleA, ruleB] } } })).toBe(10_003);

    const summaries = await readRuleRunSummaries([ruleA, ruleB], now);
    expect(summaries).toHaveLength(2);
    const a = summaries.find((row) => row.rule_key === ruleA)!;
    const b = summaries.find((row) => row.rule_key === ruleB)!;
    expect(a).toMatchObject({ latest_id: `${tag}tie1`, latest_state: "SUCCEEDED", skewed: false });
    expect(a.last_success_started?.toISOString()).toBe(tie.toISOString());
    expect(a.last_failure?.toISOString()).toBe(tie.toISOString());
    expect(a.last_failure_code).toBe("DATABASE_BUSY");
    // Rule B newest believable run is i = 4999 (SUCCEEDED); newest failure i = 4998.
    expect(b).toMatchObject({ latest_state: "SUCCEEDED", skewed: true });
    expect(b.latest_started?.toISOString()).toBe(new Date(start + 4999 * minute).toISOString());
    expect(b.last_failure?.toISOString()).toBe(new Date(start + 4998 * minute + 1000).toISOString());
    expect(b.last_failure_ref).toBe(`ref-${(4998).toString(16).padStart(10, "0")}`);

    await prisma.$executeRawUnsafe('ANALYZE "AutomationRun"');
    const plan = await prisma.$queryRaw<Record<string, string>[]>(Prisma.sql`EXPLAIN ${ruleRunSummarySql([ruleA, ruleB], now)}`);
    const text = plan.map((row) => Object.values(row).join(" ")).join("\n");
    expect(text).toContain("Index");
    expect(text).toMatch(/AutomationRun_ruleKey_(state_)?startedAt_idx/);
  }, 60_000);
});

describe.skipIf(!enabled)("MCP-1 late grace setting (real Postgres)", () => {
  let original = RECOMMENDED_LATE_GRACE_MINUTES;

  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { automationLateGraceMinutes: original } });
  });

  it("starts at 2 hours, is owner-only, audited, refuses stale saves and restores", async () => {
    await prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {} });
    original = await getLateGraceMinutes();
    const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER", archivedAt: null }, select: { id: true } });
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN", archivedAt: null }, select: { id: true } });
    await expect(saveLateGraceMinutes(admin.id, 30, original)).rejects.toThrow(/no longer has access/);
    await expect(saveLateGraceMinutes(owner.id, 10, original)).rejects.toThrow(/15 minutes/);
    await saveLateGraceMinutes(owner.id, 45, original);
    expect(await getLateGraceMinutes()).toBe(45);
    await expect(saveLateGraceMinutes(owner.id, 60, 99)).rejects.toThrow(/another session/);
    expect(await getLateGraceMinutes()).toBe(45);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "automation.late_grace.update", userId: owner.id }, orderBy: { createdAt: "desc" },
    });
    expect(audit?.newValue).toEqual({ automationLateGraceMinutes: 45 });
    await saveLateGraceMinutes(owner.id, RECOMMENDED_LATE_GRACE_MINUTES, 45);
    expect(await getLateGraceMinutes()).toBe(120);
    // The database refuses an out-of-range value even if a caller skipped the check.
    await expect(prisma.businessSettings.update({ where: { id: "singleton" }, data: { automationLateGraceMinutes: 5 } })).rejects.toThrow();
  });
});
