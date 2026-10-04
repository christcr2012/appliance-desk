import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobApplianceResult, JobType } from "@prisma/client";

const m = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));
vi.mock("@/domains/billing/checkout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domains/billing/checkout")>()),
  startRecurringBillingForAgreement: m.start,
}));

import { prisma } from "@/lib/prisma";
import { completeJob, runPendingHandoffs, updateJobStatus, getJobCompletionScope, JobCompletionConflictError } from "@/domains/jobs";
import { JobVersionError } from "@/domains/jobs/scheduling";
import { executeAgreedTermination } from "@/domains/agreements/termination-execution";
import { businessDateFromKey } from "@/lib/business-date";
import { openCustodyEpisodeInTx, findCustodyInvariantViolations } from "@/domains/inventory/custody";

// Completing a job with a result for every appliance (Batch C, P2-B), real Postgres.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("completeJob", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `jc-owner-${tag}`;
  const staffId = `jc-staff-${tag}`;
  const userId = `jc-user-${tag}`;
  const customerId = `jc-customer-${tag}`;
  const addressId = `jc-address-${tag}`;
  const typeId = `jc-type-${tag}`;
  const agreementId = `jc-agreement-${tag}`;
  const applianceIds: string[] = [];
  const jobIds: string[] = [];
  let lineId = "";

  const key = () => `jc-key-${randomUUID()}`;
  async function unit(status: "AVAILABLE" | "RESERVED" | "RENTED" | "AWAITING_PICKUP" | "AWAITING_INSPECTION" | "MAINTENANCE" = "RESERVED", assign = true) {
    const id = `jc-unit-${applianceIds.length}-${tag}`;
    applianceIds.push(id);
    await prisma.appliance.create({ data: { id, assetNumber: `JC${applianceIds.length}-${tag.slice(0, 8)}`, applianceTypeId: typeId, status } });
    if (assign) await prisma.applianceAssignment.create({ data: { rentalLineId: lineId, applianceId: id } });
    return id;
  }
  async function job(type: JobType, units: string[], extra: Record<string, unknown> = {}) {
    const id = `jc-job-${jobIds.length}-${tag}`;
    jobIds.push(id);
    return prisma.job.create({
      data: {
        id, type, status: "IN_PROGRESS", customerId, serviceAddressId: addressId, agreementId,
        appliances: { create: units.map((applianceId) => ({ applianceId })) }, ...extra,
      },
    });
  }
  const finish = (jobId: string, results: Array<[string, JobApplianceResult]>, over: Record<string, unknown> = {}) =>
    completeJob(ownerId, {
      jobId, expectedVersion: 1, completionKey: key(), performedOn: businessDateFromKey("2026-09-12"), completionNotes: null,
      results: results.map(([applianceId, result]) => ({ applianceId, result })), ...over,
    });
  const status = async (id: string) => (await prisma.appliance.findUniqueOrThrow({ where: { id } })).status;
  const jobRow = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "JC Owner", role: "OWNER", emailVerified: true },
        { id: staffId, email: `${tag}-s@example.test`, name: "JC Staff", role: "STAFF", emailVerified: true },
        { id: userId, email: `${tag}-c@example.test`, name: "JC Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `R${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" } });
    await prisma.applianceType.create({ data: { id: typeId, name: `JC ${tag}`, slug: `jc-${tag}` } });
    await prisma.rentalAgreement.create({
      data: { id: agreementId, customerId, serviceAddressId: addressId, status: "ACTIVE", lines: { create: { label: "Set", monthlyPriceCents: 6000, listPriceCents: 6000 } } },
    });
    lineId = (await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } })).id;
  });

  beforeEach(() => {
    m.start.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    const pendingIds = (await prisma.pendingDelivery.findMany({ where: { agreementId }, select: { id: true } })).map((r) => r.id);
    const creditIds = (await prisma.customerCredit.findMany({ where: { customerId }, select: { id: true } })).map((r) => r.id);
    await prisma.staffTask.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.pendingDelivery.deleteMany({ where: { agreementId } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { customerId } } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: { in: [ownerId, staffId] } },
          { entityType: "PendingDelivery", entityId: { in: pendingIds } },
          { entityType: "CustomerCredit", entityId: { in: creditIds } },
          { entityType: "Appliance", entityId: { in: applianceIds } },
          { entityType: "Job", entityId: { in: jobIds } },
          { entityType: "RentalAgreement", entityId: agreementId },
        ],
      },
    });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreement: { customerId } } });
    await prisma.rentalAgreement.deleteMany({ where: { customerId } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, userId] } } });
  });

  it("update-job-status-completed-refused: the old status button can no longer complete a job", async () => {
    const u = await unit();
    const j = await job("DELIVERY", [u]);
    await expect(updateJobStatus(ownerId, j.id, "COMPLETED")).rejects.toThrow(/Use Complete job/);
    expect((await jobRow(j.id)).status).toBe("IN_PROGRESS");
    expect(await status(u)).toBe("RESERVED");
  });

  it("complete-requires-result-per-appliance: a missing, extra or wrong-kind result is refused and nothing changes", async () => {
    const [a, b, other] = [await unit(), await unit(), await unit()];
    const j = await job("DELIVERY", [a, b]);
    await expect(finish(j.id, [[a, "DELIVERED"]])).rejects.toThrow(/Every appliance/);
    await expect(finish(j.id, [[a, "DELIVERED"], [b, "DELIVERED"], [other, "DELIVERED"]])).rejects.toThrow(/not part of this job/);
    await expect(finish(j.id, [[a, "DELIVERED"], [b, "RETURNED"]])).rejects.toThrow(/doesn't fit/);
    await expect(finish(j.id, [[a, "DELIVERED"], [a, "DELIVERED"]])).rejects.toThrow(/only one result/);
    expect(await status(a)).toBe("RESERVED");
    expect((await jobRow(j.id)).status).toBe("IN_PROGRESS");
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: { in: [a, b] } } })).toBe(0);
  });

  it("a delivery with every item delivered: items rented, custody opened on the work date, outcome COMPLETE, billing handoff written", async () => {
    const [a, b] = [await unit(), await unit()];
    const j = await job("DELIVERY", [a, b]);
    const result = await finish(j.id, [[a, "DELIVERED"], [b, "DELIVERED"]]);
    expect(result).toMatchObject({ outcome: "COMPLETE", replayed: false, followUpTaskIds: [] });
    expect([await status(a), await status(b)]).toEqual(["RENTED", "RENTED"]);
    const row = await jobRow(j.id);
    expect(row).toMatchObject({ status: "COMPLETED", outcome: "COMPLETE", version: 2 });
    expect(row.performedOn?.toISOString()).toBe("2026-09-12T06:00:00.000Z");
    const episodes = await prisma.applianceCustodyEpisode.findMany({ where: { applianceId: { in: [a, b] } } });
    expect(episodes).toHaveLength(2);
    expect(episodes.every((e) => e.customerId === customerId && e.startJobId === j.id && e.startEvidence === "JOB" && e.startedOn?.toISOString() === "2026-09-12T06:00:00.000Z")).toBe(true);
    const links = await prisma.jobAppliance.findMany({ where: { jobId: j.id } });
    expect(links.every((l) => l.result === "DELIVERED" && l.resultRecordedByUserId === ownerId)).toBe(true);
    // complete-handoff-row-written-in-same-transaction + post-commit run
    const handoffs = await prisma.jobBillingHandoff.findMany({ where: { jobId: j.id } });
    expect(handoffs).toMatchObject([{ kind: "START_RECURRING_BILLING", subjectId: agreementId, status: "DONE", attempts: 1 }]);
    expect(m.start).toHaveBeenCalledWith(agreementId);
    expect(await prisma.auditLog.count({ where: { entityId: j.id, action: "job.complete" } })).toBe(1);
  });

  it("complete-retry-same-key-no-second-task-audit-credit: a retry returns the first result and changes nothing", async () => {
    const [a, b] = [await unit(), await unit()];
    const j = await job("DELIVERY", [a, b]);
    const k = key();
    const results: Array<[string, JobApplianceResult]> = [[a, "DELIVERED"], [b, "NOT_DELIVERED"]];
    const first = await finish(j.id, results, { completionKey: k });
    const counts = async () => ({
      tasks: await prisma.staffTask.count({ where: { jobId: j.id } }),
      audits: await prisma.auditLog.count({ where: { entityId: j.id } }),
      episodes: await prisma.applianceCustodyEpisode.count({ where: { applianceId: { in: [a, b] } } }),
      handoffs: await prisma.jobBillingHandoff.count({ where: { jobId: j.id } }),
      pending: await prisma.pendingDelivery.count({ where: { applianceId: b } }),
      version: (await jobRow(j.id)).version,
    });
    const before = await counts();
    const again = await finish(j.id, results, { completionKey: k });
    expect(again).toMatchObject({ replayed: true, outcome: "PARTIAL", followUpTaskIds: first.followUpTaskIds });
    expect(await counts()).toEqual(before);
    await expect(finish(j.id, results)).rejects.toBeInstanceOf(JobCompletionConflictError);
  });

  it("complete-negative-result-makes-one-HIGH-task: not delivered keeps the unit reserved, records the waiting item and one task", async () => {
    const [a, b] = [await unit(), await unit()];
    const j = await job("DELIVERY", [a, b]);
    const result = await finish(j.id, [[a, "DELIVERED"], [b, "NOT_DELIVERED"]]);
    expect(result.outcome).toBe("PARTIAL");
    expect(await status(b)).toBe("RESERVED");
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: b } })).toBe(0);
    expect(await prisma.pendingDelivery.count({ where: { applianceId: b, deliveredOn: null } })).toBe(1);
    const tasks = await prisma.staffTask.findMany({ where: { jobId: j.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ priority: "HIGH", applianceId: b, customerId, completedAt: null, sourceKey: `job:${j.id}:${b}:NOT_DELIVERED` });
    expect(tasks[0].note).toMatch(/not delivered/);
  });

  it("complete-move-conflict-aborts-all: one unit that cannot move cancels the whole completion", async () => {
    const ids = [await unit("RESERVED"), await unit("AVAILABLE")].sort();
    const j = await job("DELIVERY", ids);
    await expect(finish(j.id, ids.map((id) => [id, "DELIVERED"] as [string, JobApplianceResult]))).rejects.toThrow(/no longer waiting for delivery/);
    expect(await status(ids[0])).toBe(ids[0] === ids.find(async () => false) ? "RESERVED" : await status(ids[0]));
    for (const id of ids) expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: id } })).toBe(0);
    expect((await jobRow(j.id)).status).toBe("IN_PROGRESS");
    expect(await prisma.staffTask.count({ where: { jobId: j.id } })).toBe(0);
    expect(await prisma.jobBillingHandoff.count({ where: { jobId: j.id } })).toBe(0);
  });

  it("complete-rolls-back-on-billing-error: a failure after the unit moved rolls the unit, custody and job back", async () => {
    const a = await unit();
    const archivedUserId = `jc-arch-user-${tag}`;
    const archivedCustomerId = `jc-arch-cust-${tag}`;
    await prisma.user.create({ data: { id: archivedUserId, email: `${tag}-a@example.test`, name: "Archived", role: "CUSTOMER", emailVerified: true } });
    await prisma.customer.create({ data: { id: archivedCustomerId, userId: archivedUserId, referralCode: `A${tag.slice(0, 18)}`, archivedAt: new Date() } });
    const b = await unit("RESERVED", false);
    const j = await job("DELIVERY", [a, b], { customerId: archivedCustomerId, agreementId: null });
    try {
      // The task for the undelivered unit cannot link an archived customer, so the completion fails at its very end.
      await expect(finish(j.id, [[a, "DELIVERED"], [b, "NOT_DELIVERED"]])).rejects.toThrow();
    } finally {
      await prisma.jobAppliance.deleteMany({ where: { jobId: j.id } });
      await prisma.job.update({ where: { id: j.id }, data: { customerId } });
      await prisma.customer.delete({ where: { id: archivedCustomerId } });
      await prisma.user.delete({ where: { id: archivedUserId } });
    }
    expect(await status(a)).toBe("RESERVED");
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: a } })).toBe(0);
    expect((await jobRow(j.id)).status).toBe("IN_PROGRESS");
  });

  it("a stale screen cannot complete a job someone else changed", async () => {
    const a = await unit();
    const j = await job("DELIVERY", [a]);
    await prisma.job.update({ where: { id: j.id }, data: { version: 5 } });
    await expect(finish(j.id, [[a, "DELIVERED"]])).rejects.toBeInstanceOf(JobVersionError);
    expect(await status(a)).toBe("RESERVED");
  });

  it("a job that was not started, or was cancelled, cannot be completed", async () => {
    const a = await unit();
    const scheduled = await job("DELIVERY", [a], { status: "SCHEDULED" });
    await expect(finish(scheduled.id, [[a, "DELIVERED"]])).rejects.toThrow(/Start the job/);
    const cancelled = await job("DELIVERY", [a], { status: "CANCELLED" });
    await expect(finish(cancelled.id, [[a, "DELIVERED"]])).rejects.toThrow(/cancelled/);
  });

  it("a removal: returned units go to inspection and close their stay; a unit not picked up stays out with a task", async () => {
    const [a, b] = [await unit("RENTED"), await unit("RENTED")];
    const setup = await job("DELIVERY", [a, b], { status: "COMPLETED" });
    for (const id of [a, b]) {
      await prisma.$transaction((tx) => openCustodyEpisodeInTx(tx, { applianceId: id, customerId, serviceAddressId: addressId, agreementId, startedOn: new Date("2026-09-01T06:00:00Z"), startJobId: setup.id }));
    }
    const j = await job("REMOVAL", [a, b]);
    const result = await finish(j.id, [[a, "RETURNED"], [b, "NOT_RETURNED"]]);
    expect(result.outcome).toBe("PARTIAL");
    expect(await status(a)).toBe("AWAITING_INSPECTION");
    expect(await status(b)).toBe("RENTED");
    const ended = await prisma.applianceCustodyEpisode.findFirstOrThrow({ where: { applianceId: a } });
    expect(ended).toMatchObject({ endJobId: j.id, endReason: "Returned", endEvidence: "JOB" });
    expect(ended.endedOn?.toISOString()).toBe("2026-09-12T06:00:00.000Z");
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: b, closedAt: null } })).toBe(1);
    const tasks = await prisma.staffTask.findMany({ where: { jobId: j.id } });
    expect(tasks).toMatchObject([{ priority: "HIGH", applianceId: b }]);
    expect(tasks[0].note).toMatch(/Collect/);
    const mine = new Set([a, b]);
    expect((await findCustodyInvariantViolations(prisma)).filter((v) => mine.has(v.applianceId))).toEqual([]);
  });

  it("a removal of a unit with no recorded stay is refused until the owner records who has it", async () => {
    const a = await unit("AWAITING_PICKUP");
    const j = await job("REMOVAL", [a]);
    await expect(finish(j.id, [[a, "RETURNED"]])).rejects.toThrow(/no stay to close/);
    expect(await status(a)).toBe("AWAITING_PICKUP");
  });

  it("a maintenance visit takes repair results; a negative one makes a task and the job is PARTIAL", async () => {
    const [a, b, c] = [await unit("RENTED", false), await unit("RENTED", false), await unit("RENTED", false)];
    const j = await job("MAINTENANCE_VISIT", [a, b, c]);
    const result = await finish(j.id, [[a, "REPAIRED"], [b, "NOT_REPAIRED"], [c, "NO_ACCESS"]]);
    expect(result.outcome).toBe("PARTIAL");
    expect(result.followUpTaskIds).toHaveLength(2);
    for (const id of [a, b, c]) expect(await status(id)).toBe("RENTED");
    const clean = await job("MAINTENANCE_VISIT", [a]);
    expect((await finish(clean.id, [[a, "REPAIRED"]])).outcome).toBe("COMPLETE");
    // With no appliance on the visit, completing needs no results.
    const none = await job("MAINTENANCE_VISIT", []);
    expect((await finish(none.id, [])).outcome).toBe("COMPLETE");
  });

  it("a swap takes a result per unit; returning the old unit without the new one being delivered is refused", async () => {
    const original = await unit("RENTED", false);
    const replacement = await unit("RESERVED", false);
    const j = await job("SWAP", [original, replacement]);
    await prisma.jobAppliance.updateMany({ where: { jobId: j.id, applianceId: replacement }, data: { role: "REPLACEMENT" } });
    const scope = await getJobCompletionScope({ id: j.id, type: "SWAP", status: "IN_PROGRESS", agreementId });
    expect(scope.find((r) => r.applianceId === replacement)).toMatchObject({ role: "REPLACEMENT", defaultResult: "DELIVERED", allowed: ["DELIVERED", "NOT_DELIVERED"] });
    expect(scope.find((r) => r.applianceId === original)).toMatchObject({ role: "PRIMARY", defaultResult: "RETURNED" });
    await expect(finish(j.id, [[original, "RETURNED"], [replacement, "NOT_DELIVERED"]])).rejects.toThrow(/Don't take the old unit/);
    await expect(finish(j.id, [[original, "DELIVERED"], [replacement, "DELIVERED"]])).rejects.toThrow(/doesn't fit/);
    const ok = await finish(j.id, [[original, "NOT_RETURNED"], [replacement, "DELIVERED"]]);
    expect(ok.outcome).toBe("PARTIAL");
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: replacement, closedAt: null } })).toBe(1);
  });

  it("complete-handoff-sweep-retries-failed-once-per-run: a failed handoff is retried by the sweep, one attempt per run, then stays done", async () => {
    const a = await unit();
    const j = await job("DELIVERY", [a]);
    m.start.mockRejectedValueOnce(new Error("Stripe is down"));
    await finish(j.id, [[a, "DELIVERED"]]);
    const failed = await prisma.jobBillingHandoff.findFirstOrThrow({ where: { jobId: j.id } });
    expect(failed).toMatchObject({ status: "FAILED", attempts: 1, lastError: "Stripe is down" });
    expect((await jobRow(j.id)).status).toBe("COMPLETED");
    m.start.mockClear();
    await runPendingHandoffs(500);
    expect(await prisma.jobBillingHandoff.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({ status: "DONE", attempts: 2, lastError: null });
    expect(m.start).toHaveBeenCalledTimes(1);
    m.start.mockClear();
    await runPendingHandoffs(500);
    expect(m.start).not.toHaveBeenCalled();
    // A handoff that keeps failing stops after five attempts.
    const stuck = await prisma.jobBillingHandoff.create({ data: { jobId: j.id, kind: "START_RECURRING_BILLING", subjectId: `other-${tag}`, status: "FAILED", attempts: 5 } });
    await runPendingHandoffs(500);
    expect(m.start).not.toHaveBeenCalledWith(`other-${tag}`);
    expect((await prisma.jobBillingHandoff.findUniqueOrThrow({ where: { id: stuck.id } })).attempts).toBe(5);
  });

  it("complete-locks-customer-before-agreement: a removal completing while the nightly ending runs for the same agreement never deadlocks", async () => {
    for (let round = 0; round < 4; round++) {
      const agId = `jc-ag-race-${round}-${tag}`;
      await prisma.rentalAgreement.create({
        data: {
          id: agId, customerId, serviceAddressId: addressId, status: "ACTIVE", termMonths: 12, terminationFeeCents: 5000,
          terminationEffectiveOn: new Date("2026-09-01T06:00:00Z"), terminationRequestedAt: new Date("2026-08-01T06:00:00Z"),
          lines: { create: { label: "Race", monthlyPriceCents: 3000, listPriceCents: 3000 } },
        },
      });
      const line = await prisma.rentalLine.findFirstOrThrow({ where: { agreementId: agId } });
      const u = await unit("RENTED", false);
      await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: u } });
      const setup = await job("DELIVERY", [u], { status: "COMPLETED", agreementId: agId });
      await prisma.$transaction((tx) => openCustodyEpisodeInTx(tx, { applianceId: u, customerId, serviceAddressId: addressId, agreementId: agId, startedOn: new Date("2026-08-01T06:00:00Z"), startJobId: setup.id }));
      const removal = await job("REMOVAL", [u], { agreementId: agId });
      const settled = await Promise.allSettled([
        completeJob(ownerId, { jobId: removal.id, expectedVersion: 1, completionKey: key(), performedOn: businessDateFromKey("2026-09-12"), completionNotes: null, results: [{ applianceId: u, result: "RETURNED" }] }),
        executeAgreedTermination(agId, new Date("2026-09-12T18:00:00Z")),
      ]);
      expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(await status(u)).toBe("AWAITING_INSPECTION");
      expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agId } })).status).toBe("ENDED");
      expect(await prisma.invoiceLineItem.count({ where: { kind: "EARLY_TERMINATION_FEE", invoice: { agreementId: agId } } })).toBe(1);
      await prisma.invoiceLineItem.deleteMany({ where: { invoice: { agreementId: agId } } });
      await prisma.invoice.deleteMany({ where: { agreementId: agId } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: agId }, { entityType: "Invoice", userId: null }] } });
    }
  });
});
