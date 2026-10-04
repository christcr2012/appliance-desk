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

describe.skipIf(!enabled)("R1 provider-clock handoff defer (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const jobId = `r1-provider-clock-job-${tag}`;
  const subjectId = `r1-provider-clock-agreement-${tag}`;

  beforeEach(() => {
    vi.clearAllMocks();
    handoffMocks.pushCredit.mockResolvedValue({ state: "DONE" });
  });

  afterAll(async () => {
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
  });

  it("keeps retry budget while the provider clock is early, then completes the same handoff", async () => {
    await prisma.job.create({ data: { id: jobId, type: "DELIVERY", status: "COMPLETED" } });
    const row = await prisma.jobBillingHandoff.create({
      data: { jobId, kind: "START_RECURRING_BILLING", subjectId },
    });

    handoffMocks.startBilling.mockResolvedValueOnce({
      state: "BLOCKED",
      detail: "Recurring billing is waiting until Stripe's safe billing boundary for today's delivery date.",
    });

    await expect(runPendingHandoffs(1)).resolves.toEqual({ done: 0, failed: 1 });
    const deferred = await prisma.jobBillingHandoff.findUniqueOrThrow({ where: { id: row.id } });
    expect(deferred).toMatchObject({ status: "FAILED", attempts: 0, claimedAt: null });
    expect(deferred.lastError).toMatch(/^BLOCKED:\d{4}-\d{2}-\d{2}T/);

    handoffMocks.startBilling.mockResolvedValueOnce({ state: "DONE" });
    await expect(runPendingHandoffs(1)).resolves.toEqual({ done: 1, failed: 0 });
    expect(await prisma.jobBillingHandoff.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "DONE",
      attempts: 1,
      claimedAt: null,
      lastError: null,
    });
  });
});
