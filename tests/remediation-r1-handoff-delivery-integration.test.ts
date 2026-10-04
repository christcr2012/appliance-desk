import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { businessDateFromKey } from "@/lib/business-date";
import { completeJob, runPendingHandoffs } from "@/domains/jobs/completion";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const DONE = { state: "DONE" as const };

describe.skipIf(!enabled)("Remediation R1 delivery facts and handoff leases (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `r1-owner-${tag}`;
  const customerUserId = `r1-user-${tag}`;
  const customerId = `r1-customer-${tag}`;
  const addressId = `r1-address-${tag}`;
  const typeId = `r1-type-${tag}`;
  const agreementIds: string[] = [];
  const applianceIds: string[] = [];
  const jobIds: string[] = [];

  async function createDeliveryFixture(suffix: string, unitCount = 1) {
    const agreementId = `r1-agreement-${suffix}-${tag}`;
    const jobId = `r1-job-${suffix}-${tag}`;
    agreementIds.push(agreementId);
    jobIds.push(jobId);

    const agreement = await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        lines: {
          create: {
            label: `Rental ${suffix}`,
            monthlyPriceCents: 4000 * unitCount,
            listPriceCents: 4000 * unitCount,
          },
        },
      },
      include: { lines: true },
    });
    const line = agreement.lines[0]!;
    const units: string[] = [];
    for (let i = 0; i < unitCount; i += 1) {
      const applianceId = `r1-unit-${suffix}-${i}-${tag}`;
      applianceIds.push(applianceId);
      units.push(applianceId);
      await prisma.appliance.create({
        data: {
          id: applianceId,
          assetNumber: `R1-${suffix}-${i}-${tag.slice(0, 6)}`,
          applianceTypeId: typeId,
          status: "RESERVED",
        },
      });
      await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId } });
    }
    await prisma.job.create({
      data: {
        id: jobId,
        type: "DELIVERY",
        status: "IN_PROGRESS",
        customerId,
        serviceAddressId: addressId,
        agreementId,
        appliances: { create: units.map((applianceId) => ({ applianceId })) },
      },
    });
    return { agreementId, jobId, units };
  }

  async function finish(
    jobId: string,
    results: Array<{ applianceId: string; result: "DELIVERED" | "NOT_DELIVERED" }>,
    dateKey: string,
  ) {
    return completeJob(ownerId, {
      jobId,
      expectedVersion: 1,
      completionKey: `r1-complete-${randomUUID()}`,
      performedOn: businessDateFromKey(dateKey),
      completionNotes: null,
      results,
    });
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-owner@example.test`, name: "R1 Owner", role: "OWNER", emailVerified: true },
        { id: customerUserId, email: `${tag}-customer@example.test`, name: "R1 Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({
      data: { id: customerId, userId: customerUserId, referralCode: `R1${tag.slice(0, 18)}` },
    });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "1 Remediation Way", city: "Greeley", zip: "80631" },
    });
    await prisma.applianceType.create({
      data: { id: typeId, name: `R1 Type ${tag}`, slug: `r1-type-${tag}`, monthlyPriceCents: 4000 },
    });
  });

  beforeEach(async () => {
    // The sweep is intentionally global. Remove this suite's handoffs from prior
    // cases so each lease assertion measures only the row created by that case.
    if (jobIds.length > 0) {
      await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    }
    vi.clearAllMocks();
    handoffMocks.startBilling.mockResolvedValue(DONE);
    handoffMocks.pushCredit.mockResolvedValue(DONE);
  });

  afterAll(async () => {
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.staffTask.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.pendingDelivery.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: ownerId },
          { entityId: { in: [...jobIds, ...agreementIds, ...applianceIds] } },
        ],
      },
    });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, customerUserId] } } });
  });

  it("records no first-delivery fact and creates no recurring-billing handoff when nothing was delivered", async () => {
    const fixture = await createDeliveryFixture("zero");
    await finish(fixture.jobId, [{ applianceId: fixture.units[0]!, result: "NOT_DELIVERED" }], "2026-10-01");

    const agreement = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: fixture.agreementId } });
    expect(agreement.firstDeliveredOn).toBeNull();
    expect(agreement.billingStartedAt).toBeNull();
    expect(
      await prisma.jobBillingHandoff.count({
        where: { jobId: fixture.jobId, kind: "START_RECURRING_BILLING" },
      }),
    ).toBe(0);
    expect(handoffMocks.startBilling).not.toHaveBeenCalled();
  });

  it("a later real delivery records the immutable business date and starts billing exactly once", async () => {
    const agreementId = agreementIds.find((id) => id.includes("-zero-"));
    expect(agreementId).toBeTruthy();
    const waiting = await prisma.pendingDelivery.findFirstOrThrow({ where: { agreementId } });
    const jobId = `r1-job-later-${tag}`;
    jobIds.push(jobId);
    await prisma.job.create({
      data: {
        id: jobId,
        type: "DELIVERY",
        status: "IN_PROGRESS",
        customerId,
        serviceAddressId: addressId,
        agreementId: agreementId!,
        appliances: { create: [{ applianceId: waiting.applianceId }] },
      },
    });

    const deliveredOn = businessDateFromKey("2026-10-02")!;
    await finish(jobId, [{ applianceId: waiting.applianceId, result: "DELIVERED" }], "2026-10-02");

    const agreement = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId! } });
    expect(agreement.firstDeliveredOn?.getTime()).toBe(deliveredOn.getTime());
    const handoff = await prisma.jobBillingHandoff.findFirstOrThrow({
      where: { jobId, kind: "START_RECURRING_BILLING" },
    });
    expect(handoff.status).toBe("DONE");
    expect(handoff.attempts).toBe(1);
    expect(handoff.claimedAt).toBeNull();
    expect(handoffMocks.startBilling).toHaveBeenCalledTimes(1);
  });

  it("a true partial delivery keeps missing-item tracking while still recording the first delivery and billing intent", async () => {
    const fixture = await createDeliveryFixture("partial", 2);
    await finish(
      fixture.jobId,
      [
        { applianceId: fixture.units[0]!, result: "DELIVERED" },
        { applianceId: fixture.units[1]!, result: "NOT_DELIVERED" },
      ],
      "2026-10-03",
    );

    const agreement = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: fixture.agreementId } });
    expect(agreement.firstDeliveredOn?.getTime()).toBe(businessDateFromKey("2026-10-03")!.getTime());
    expect(await prisma.pendingDelivery.count({ where: { agreementId: fixture.agreementId, deliveredOn: null } })).toBe(1);
    expect(await prisma.jobBillingHandoff.count({ where: { jobId: fixture.jobId, kind: "START_RECURRING_BILLING" } })).toBe(1);
    expect(handoffMocks.startBilling).toHaveBeenCalledTimes(1);
  });

  it.each([
    { state: "RETRY" as const, detail: "provider rejected safely" },
    { state: "BLOCKED" as const, detail: "missing payment method" },
    { state: "UNKNOWN" as const, detail: "provider response was ambiguous" },
  ])("never marks a $state provider outcome DONE", async (outcome) => {
    const jobId = `r1-handoff-${outcome.state}-${tag}`;
    jobIds.push(jobId);
    await prisma.job.create({ data: { id: jobId, type: "DELIVERY", status: "COMPLETED" } });
    const row = await prisma.jobBillingHandoff.create({
      data: { jobId, kind: "START_RECURRING_BILLING", subjectId: `${outcome.state}-${tag}` },
    });
    handoffMocks.startBilling.mockResolvedValueOnce(outcome);

    const result = await runPendingHandoffs(20);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    const saved = await prisma.jobBillingHandoff.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved.status).toBe("FAILED");
    expect(saved.doneAt).toBeNull();
    expect(saved.claimedAt).toBeNull();
    expect(saved.lastError).toContain(outcome.state);
  });

  it("gives one worker the in-flight lease while an overlapping worker skips the same handoff", async () => {
    const jobId = `r1-handoff-overlap-${tag}`;
    jobIds.push(jobId);
    await prisma.job.create({ data: { id: jobId, type: "DELIVERY", status: "COMPLETED" } });
    const row = await prisma.jobBillingHandoff.create({
      data: { jobId, kind: "START_RECURRING_BILLING", subjectId: `overlap-${tag}` },
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    handoffMocks.startBilling.mockImplementationOnce(async () => {
      entered();
      await gate;
      return DONE;
    });

    const workerA = runPendingHandoffs(20);
    await enteredPromise;
    const mid = await prisma.jobBillingHandoff.findUniqueOrThrow({ where: { id: row.id } });
    expect(mid.status).toBe("IN_FLIGHT");
    expect(mid.attempts).toBe(1);
    expect(mid.claimedAt).not.toBeNull();

    const workerB = await runPendingHandoffs(20);
    expect(workerB).toEqual({ done: 0, failed: 0 });
    expect(handoffMocks.startBilling).toHaveBeenCalledTimes(1);

    release();
    await expect(workerA).resolves.toEqual({ done: 1, failed: 0 });
    const saved = await prisma.jobBillingHandoff.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved).toMatchObject({ status: "DONE", attempts: 1, claimedAt: null });
  });

  it("recovers one abandoned in-flight lease and increments the lease identity", async () => {
    const jobId = `r1-handoff-stale-${tag}`;
    jobIds.push(jobId);
    await prisma.job.create({ data: { id: jobId, type: "DELIVERY", status: "COMPLETED" } });
    const row = await prisma.jobBillingHandoff.create({
      data: {
        jobId,
        kind: "START_RECURRING_BILLING",
        subjectId: `stale-${tag}`,
        status: "IN_FLIGHT",
        attempts: 1,
        claimedAt: new Date(Date.now() - 10 * 60_000),
      },
    });

    await expect(runPendingHandoffs(20)).resolves.toEqual({ done: 1, failed: 0 });
    const saved = await prisma.jobBillingHandoff.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved).toMatchObject({ status: "DONE", attempts: 2, claimedAt: null });
    expect(handoffMocks.startBilling).toHaveBeenCalledTimes(1);
  });
});
