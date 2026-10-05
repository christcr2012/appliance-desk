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

describe.skipIf(!enabled)("Remediation R1 deferred handoff fairness (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const jobIds: string[] = [];

  async function createCompletedJob(suffix: string) {
    const id = `r1-fair-${suffix}-${tag}`;
    jobIds.push(id);
    await prisma.job.create({ data: { id, type: "DELIVERY", status: "COMPLETED" } });
    return id;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    handoffMocks.startBilling.mockResolvedValue(DONE);
    handoffMocks.pushCredit.mockResolvedValue(DONE);
  });

  afterAll(async () => {
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
  });

  it("orders BLOCKED and UNKNOWN work by retry time instead of state prefix", async () => {
    const blockedJobId = await createCompletedJob("blocked-newer");
    const unknownJobId = await createCompletedJob("unknown-older");
    const blockedSubject = `r1-fair-blocked-${tag}`;
    const unknownSubject = `r1-fair-unknown-${tag}`;

    await prisma.jobBillingHandoff.create({
      data: {
        jobId: blockedJobId,
        kind: "START_RECURRING_BILLING",
        subjectId: blockedSubject,
        status: "FAILED",
        attempts: 0,
        lastError: "BLOCKED:2026-01-02T00:00:00.000Z: missing payment method",
      },
    });
    await prisma.jobBillingHandoff.create({
      data: {
        jobId: unknownJobId,
        kind: "START_RECURRING_BILLING",
        subjectId: unknownSubject,
        status: "FAILED",
        attempts: 0,
        lastError: "UNKNOWN:2026-01-01T00:00:00.000Z: provider result ambiguous",
      },
    });

    await expect(runPendingHandoffs(1)).resolves.toEqual({ done: 1, failed: 0 });
    await expect(runPendingHandoffs(1)).resolves.toEqual({ done: 1, failed: 0 });

    expect(handoffMocks.startBilling).toHaveBeenNthCalledWith(1, unknownSubject);
    expect(handoffMocks.startBilling).toHaveBeenNthCalledWith(2, blockedSubject);
  });
});
