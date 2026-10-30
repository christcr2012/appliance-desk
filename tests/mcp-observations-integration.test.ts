import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { SETTING_ROWS } from "@/domains/settings/catalog";
import { getObservations, prunePerformanceSamples } from "@/domains/agent-control/performance";
import { checkOptimizationTargets, createOptimizationProposal, decideOptimizationProposal } from "@/domains/agent-control/optimization";

const suffix = randomUUID().replaceAll("-", "").slice(0, 20);
const ownerId = "perf-owner-" + suffix;
const staffId = "perf-staff-" + suffix;
const t = (value: string) => new Date(value);
const windowNow = t("2041-06-01T12:00:00Z");
const name = "desk:system-health";
const baseInput = {
  title: "Reduce system health page latency",
  observation: { window: "7d" as const, kind: "PAGE" as const, name },
  settingKeys: [],
  expectedBenefit: "Reduce the measured page p95 duration",
  risk: "A change could delay the health dashboard",
  costNote: "No additional hosting spend is authorized",
  measurementPlan: "Compare 30 or more post-change samples",
  rollback: "Revert the reviewed code change if p95 worsens",
};

describe("MCP-8 disposable-PostgreSQL measurements and proposals", () => {
  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerId, role: "OWNER", name: "Synthetic speed owner", email: ownerId + "@example.test" },
      { id: staffId, role: "STAFF", name: "Synthetic speed staff", email: staffId + "@example.test" },
    ] });
  });
  beforeEach(async () => {
    await prisma.perfSample.deleteMany({ where: {
      at: { gte: t("2040-01-01T00:00:00Z"), lt: t("2042-01-01T00:00:00Z") },
    } });
    await prisma.optimizationProposal.deleteMany({ where: { createdByUserId: ownerId } });
    await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
  });
  afterAll(async () => {
    await prisma.perfSample.deleteMany({ where: {
      at: { gte: t("2040-01-01T00:00:00Z"), lt: t("2042-01-01T00:00:00Z") },
    } });
    await prisma.optimizationProposal.deleteMany({ where: { createdByUserId: ownerId } });
    await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await prisma.$disconnect();
  });

  async function seedSamples(count: number, at: Date, duration = (i: number) => i + 1) {
    await prisma.perfSample.createMany({ data: Array.from({ length: count }, (_, i) => ({
      kind: "PAGE", name, at, ms: duration(i), ok: i % 10 !== 0,
    })) });
  }

  it("never invents percentiles with 29 samples; 30 reveal exact p50/p95 and previous-window comparison", async () => {
    await seedSamples(30, t("2041-05-20T12:00:00Z"), () => 10);
    await seedSamples(29, t("2041-05-30T12:00:00Z"));
    const insufficient = await getObservations({ window: "7d", kind: "PAGE", now: windowNow });
    const missing = insufficient.rows.find(row => row.name === name)!;
    expect(missing.samples).toBe(29);
    expect(missing.status).toBe("NOT_ENOUGH_DATA");
    expect(missing.message).toBe("Not enough data yet");
    expect(missing.p95Ms).toBeNull();
    expect(missing.errorRatePercent).toBeNull();
    await seedSamples(1, t("2041-05-30T12:00:00Z"), () => 30);
    const sufficient = await getObservations({ window: "7d", kind: "PAGE", now: windowNow });
    const row = sufficient.rows.find(item => item.name === name)!;
    expect(row.status).toBe("ENOUGH");
    expect(row.samples).toBe(30);
    expect(row.p50Ms).toBe(15);
    expect(row.p95Ms).toBe(29);
    expect(row.errorRatePercent).toBe(13.33);
    expect(row.previousSamples).toBe(30);
    expect(row.previousP95Ms).toBe(10);
    expect(row.p95ChangePercent).toBe(190);
  });

  it("prunes no more than 5,000 stale records; leaves recent evidence untouched", async () => {
    await seedSamples(5_002, t("2040-04-01T00:00:00Z"), () => 2);
    await seedSamples(1, t("2041-05-30T12:00:00Z"));
    expect(await prunePerformanceSamples(windowNow)).toBe(5_000);
    expect(await prisma.perfSample.count({ where: { at: t("2040-04-01T00:00:00Z") } })).toBe(2);
    expect(await prisma.perfSample.count({ where: { at: t("2041-05-30T12:00:00Z") } })).toBe(1);
  });

  it("protected prices, fees and tax choices cannot be optimization targets", () => {
    const financial = SETTING_ROWS.find(row => row.kind === "money");
    expect(financial).toBeDefined();
    expect(() => checkOptimizationTargets([financial!.key])).toThrow("PROTECTED_SETTING_KEY");
    expect(() => checkOptimizationTargets(["not-a-real-setting"])).toThrow("UNKNOWN_SETTING_KEY");
    expect(() => checkOptimizationTargets([])).not.toThrow();
  });

  it("owner-only proposal is evidence-backed; review never applies a setting", async () => {
    await seedSamples(29, t("2041-05-30T12:00:00Z"));
    await expect(createOptimizationProposal(ownerId, baseInput, { now: windowNow }))
      .rejects.toThrow("NOT_ENOUGH_PERFORMANCE_EVIDENCE");
    await seedSamples(1, t("2041-05-30T12:00:00Z"));
    await expect(createOptimizationProposal(staffId, baseInput, { now: windowNow }))
      .rejects.toThrow();
    const proposal = await createOptimizationProposal(ownerId, baseInput, { now: windowNow });
    expect(proposal.state).toBe("PROPOSED");
    const stored = await prisma.optimizationProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect((stored.observationRefs as { baseline: { samples: number } }).baseline.samples).toBe(30);
    const accepted = await decideOptimizationProposal(ownerId, { id: proposal.id, accept: true });
    expect(accepted.state).toBe("ACCEPTED");
    await expect(decideOptimizationProposal(ownerId, { id: proposal.id, accept: false }))
      .rejects.toThrow("PROPOSAL_NOT_PENDING");
    expect(await prisma.optimizationProposal.count({ where: { createdByUserId: ownerId } })).toBe(1);
  });
});
