import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const handoffMocks = vi.hoisted(() => ({
  startBilling: vi.fn(),
  pushCredit: vi.fn(),
}));

vi.mock("@/domains/billing/checkout", () => ({
  startRecurringBillingForAgreement: (...args: unknown[]) => handoffMocks.startBilling(...args),
}));
vi.mock("@/domains/billing/handoff-adapters", () => ({
  pushLateDeliveryCreditForHandoff: (...args: unknown[]) => handoffMocks.pushCredit(...args),
}));

import { prisma } from "@/lib/prisma";
import { runPendingHandoffs } from "@/domains/jobs/completion";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const DONE = { state: "DONE" as const };

describe.skipIf(!enabled)("Remediation R1 handoff queue recovery (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const jobIds: string[] = [];

  async function createCompletedJob(suffix: string) {
    const id = `r1-queue-${suffix}-${tag}`;
    jobIds.push(id);
    await prisma.job.create({ data: { id, type: "DELIVERY", status: "COMPLETED" } });
    return id;
  }

  beforeEach(async () => {
    if (jobIds.length > 0) {
      await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    }
    vi.clearAllMocks();
    handoffMocks.startBilling.mockResolvedValue(DONE);
    handoffMocks.pushCredit.mockResolvedValue(DONE);
  });

  afterAll(async () => {
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
  });

  it("does not let an older blocked handoff starve newer pending recovery work when the batch is full", async () => {
    const blockedJobId = await createCompletedJob("blocked-first");
    const pendingJobId = await createCompletedJob("pending-second");
    const blockedSubject = `blocked-subject-${tag}`;
    const pendingSubject = `pending-subject-${tag}`;

    const blocked = await prisma.jobBillingHandoff.create({
      data: {
        jobId: blockedJobId,
        kind: "START_RECURRING_BILLING",
        subjectId: blockedSubject,
        status: "FAILED",
        attempts: 0,
        lastError: "BLOCKED:2026-01-01T00:00:00.000Z: missing payment method",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const pending = await prisma.jobBillingHandoff.create({
      data: {
        jobId: pendingJobId,
        kind: "START_RECURRING_BILLING",
        subjectId: pendingSubject,
        status: "PENDING",
        attempts: 0,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    });

    handoffMocks.startBilling.mockImplementation(async (subjectId: string) =>
      subjectId === blockedSubject
        ? { state: "BLOCKED" as const, detail: "missing payment method" }
        : DONE,
    );

    await expect(runPendingHandoffs(1)).resolves.toEqual({ done: 1, failed: 0 });

    expect(handoffMocks.startBilling).toHaveBeenCalledTimes(1);
    expect(handoffMocks.startBilling).toHaveBeenCalledWith(pendingSubject);
    expect(await prisma.jobBillingHandoff.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({
      status: "DONE",
      attempts: 1,
      claimedAt: null,
    });
    expect(await prisma.jobBillingHandoff.findUniqueOrThrow({ where: { id: blocked.id } })).toMatchObject({
      status: "FAILED",
      attempts: 0,
      lastError: "BLOCKED:2026-01-01T00:00:00.000Z: missing payment method",
    });
  });

  it("rotates blocked handoffs so one missing prerequisite cannot monopolize spare capacity", async () => {
    const firstJobId = await createCompletedJob("blocked-rotate-a");
    const secondJobId = await createCompletedJob("blocked-rotate-b");
    const firstSubject = `blocked-rotate-a-${tag}`;
    const secondSubject = `blocked-rotate-b-${tag}`;

    await prisma.jobBillingHandoff.create({
      data: {
        jobId: firstJobId,
        kind: "START_RECURRING_BILLING",
        subjectId: firstSubject,
        status: "FAILED",
        attempts: 0,
        lastError: "BLOCKED:2026-01-01T00:00:00.000Z: missing payment method",
      },
    });
    await prisma.jobBillingHandoff.create({
      data: {
        jobId: secondJobId,
        kind: "START_RECURRING_BILLING",
        subjectId: secondSubject,
        status: "FAILED",
        attempts: 0,
        lastError: "BLOCKED:2026-01-02T00:00:00.000Z: missing payment method",
      },
    });
    handoffMocks.startBilling.mockResolvedValue({ state: "BLOCKED", detail: "missing payment method" });

    await expect(runPendingHandoffs(1)).resolves.toEqual({ done: 0, failed: 1 });
    await expect(runPendingHandoffs(1)).resolves.toEqual({ done: 0, failed: 1 });

    expect(handoffMocks.startBilling).toHaveBeenNthCalledWith(1, firstSubject);
    expect(handoffMocks.startBilling).toHaveBeenNthCalledWith(2, secondSubject);
  });

  it("recovers a stale in-flight lease even when the dead worker already claimed attempt five", async () => {
    const jobId = await createCompletedJob("stale-fifth");
    const subjectId = `stale-fifth-${tag}`;
    const row = await prisma.jobBillingHandoff.create({
      data: {
        jobId,
        kind: "START_RECURRING_BILLING",
        subjectId,
        status: "IN_FLIGHT",
        attempts: 5,
        claimedAt: new Date(Date.now() - 10 * 60_000),
      },
    });

    await expect(runPendingHandoffs(1)).resolves.toEqual({ done: 1, failed: 0 });

    expect(handoffMocks.startBilling).toHaveBeenCalledTimes(1);
    expect(handoffMocks.startBilling).toHaveBeenCalledWith(subjectId);
    expect(await prisma.jobBillingHandoff.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "DONE",
      attempts: 6,
      claimedAt: null,
    });
  });
});
