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
    m.start.mockReset().mockResolvedValue({ state: "DONE" });
  });

  afterAll(async () => {
    const pendingIds = (await prisma.pendingDelivery.findMany({ where: { agreementId }, select: { id: true } })).map((r) => r.id);
    const creditIds = (await prisma.customerCredit.findMany({ where: { customerId }, select: { id: true } })).map((r) => r.id);
    await prisma.staffTask.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.retailDeliveryFeeRecord.deleteMany({ where: { agreementId } });
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
  });

  it("complete-all-delivered: moves every delivered unit, opens custody, stores result/evidence and creates one billing handoff", async () => {
    const a = await unit();
    const b = await unit();
    const j = await job("DELIVERY", [a, b]);
    const out = await finish(j.id, [[a, "DELIVERED"], [b, "DELIVERED"]]);
    expect(out.outcome).toBe("COMPLETE");
    const rdf = await prisma.retailDeliveryFeeRecord.findUniqueOrThrow({
      where: { saleKey: "agreement:" + agreementId },
    });
    expect(rdf.firstJobId).toBe(j.id);
    expect(rdf.agreementId).toBe(agreementId);
    expect(rdf.status).toBe("PENDING_DECISION");
    expect(await status(a)).toBe("RENTED");
    expect(await status(b)).toBe("RENTED");
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: { in: [a, b] }, closedAt: null } })).toBe(2);
    const rows = await prisma.jobAppliance.findMany({ where: { jobId: j.id }, orderBy: { applianceId: "asc" } });
    expect(rows.map((r) => r.result)).toEqual(["DELIVERED", "DELIVERED"]);
    expect(rows.every((r) => r.resultRecordedByUserId === ownerId && r.resultRecordedAt !== null)).toBe(true);
    expect((await prisma.jobBillingHandoff.findFirstOrThrow({ where: { jobId: j.id } })).status).toBe("DONE");
  });

  it("complete-partial-delivery: delivered unit moves, missing unit stays reserved, pending delivery + follow-up are durable", async () => {
    const a = await unit();
    const b = await unit();
    const j = await job("DELIVERY", [a, b]);
    const out = await finish(j.id, [[a, "DELIVERED"], [b, "NOT_DELIVERED"]]);
    expect(out.outcome).toBe("PARTIAL");
    expect(await status(a)).toBe("RENTED");
    expect(await status(b)).toBe("RESERVED");
    expect(await prisma.pendingDelivery.count({ where: { originalJobId: j.id, applianceId: b } })).toBe(1);
    expect(await prisma.staffTask.count({ where: { jobId: j.id, applianceId: b } })).toBe(1);
  });

  it("complete-zero-delivery: missing units stay reserved and no billing handoff is created", async () => {
    const a = await unit();
    const b = await unit();
    const j = await job("DELIVERY", [a, b]);
    const out = await finish(j.id, [[a, "NOT_DELIVERED"], [b, "NOT_DELIVERED"]]);
    expect(out.outcome).toBe("PARTIAL");
    expect(await status(a)).toBe("RESERVED");
    expect(await status(b)).toBe("RESERVED");
    expect(await prisma.pendingDelivery.count({ where: { originalJobId: j.id } })).toBe(2);
    expect(await prisma.jobBillingHandoff.count({ where: { jobId: j.id, kind: "START_RECURRING_BILLING" } })).toBe(0);
  });

  it("complete-removal-returned: moves returned unit to inspection and closes custody", async () => {
    const a = await unit("RESERVED");
    const d = await job("DELIVERY", [a]);
    await finish(d.id, [[a, "DELIVERED"]]);
    const r = await job("REMOVAL", [a]);
    const out = await finish(r.id, [[a, "RETURNED"]]);
    expect(out.outcome).toBe("COMPLETE");
    expect(await status(a)).toBe("AWAITING_INSPECTION");
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: a, closedAt: null } })).toBe(0);
  });

  it("complete-removal-not-returned: leaves unit/custody unchanged and creates follow-up", async () => {
    const a = await unit("RESERVED");
    const d = await job("DELIVERY", [a]);
    await finish(d.id, [[a, "DELIVERED"]]);
    const r = await job("REMOVAL", [a]);
    const out = await finish(r.id, [[a, "NOT_RETURNED"]]);
    expect(out.outcome).toBe("PARTIAL");
    expect(await status(a)).toBe("RENTED");
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: a, closedAt: null } })).toBe(1);
    expect(await prisma.staffTask.count({ where: { jobId: r.id, applianceId: a } })).toBe(1);
  });

  it("complete-replay: same completion key returns first result without reapplying side effects", async () => {
    const a = await unit();
    const j = await job("DELIVERY", [a]);
    const completionKey = key();
    const first = await finish(j.id, [[a, "DELIVERED"]], { completionKey });
    const second = await finish(j.id, [[a, "DELIVERED"]], { completionKey, expectedVersion: 2 });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.outcome).toBe(first.outcome);
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: a } })).toBe(1);
  });

  it("complete-idempotency-key-mismatch: completed job rejects another completion identity", async () => {
    const a = await unit();
    const j = await job("DELIVERY", [a]);
    await finish(j.id, [[a, "DELIVERED"]]);
    await expect(finish(j.id, [[a, "DELIVERED"]], { expectedVersion: 2 })).rejects.toBeInstanceOf(JobCompletionConflictError);
  });

  it("complete-stale-version-refused", async () => {
    const a = await unit();
    const j = await job("DELIVERY", [a]);
    await prisma.job.update({ where: { id: j.id }, data: { version: { increment: 1 } } });
    await expect(finish(j.id, [[a, "DELIVERED"]])).rejects.toBeInstanceOf(JobVersionError);
  });

  it("complete-missing-result-refused", async () => {
    const a = await unit();
    const b = await unit();
    const j = await job("DELIVERY", [a, b]);
    await expect(finish(j.id, [[a, "DELIVERED"]])).rejects.toThrow(/Every appliance/);
  });

  it("complete-extra-result-refused", async () => {
    const a = await unit();
    const extra = await unit("AVAILABLE", false);
    const j = await job("DELIVERY", [a]);
    await expect(finish(j.id, [[a, "DELIVERED"], [extra, "DELIVERED"]])).rejects.toThrow(/not part of this job/);
  });

  it("complete-invalid-result-refused", async () => {
    const a = await unit();
    const j = await job("DELIVERY", [a]);
    await expect(finish(j.id, [[a, "RETURNED"]])).rejects.toThrow(/doesn't fit/);
  });

  it("complete-future-performed-on-refused", async () => {
    const a = await unit();
    const j = await job("DELIVERY", [a]);
    await expect(finish(j.id, [[a, "DELIVERED"]], { performedOn: new Date("2099-01-01T07:00:00Z") })).rejects.toThrow(/future/);
  });

  it("complete-removal-refuses an appliance whose custody belongs to a different customer", async () => {
    const otherUser = `jc-other-user-${tag}`;
    const otherCustomer = `jc-other-customer-${tag}`;
    await prisma.user.create({ data: { id: otherUser, email: `${tag}-other@example.test`, role: "CUSTOMER", emailVerified: true } });
    await prisma.customer.create({ data: { id: otherCustomer, userId: otherUser, referralCode: `O${tag.slice(0, 18)}` } });
    const held = await unit("RENTED");
    const removal = await job("REMOVAL", [held]);
    try {
      await openCustodyEpisodeInTx(prisma, { applianceId: held, customerId: otherCustomer, serviceAddressId: null, agreementId: null, startedOn: businessDateFromKey("2026-09-01")!, startJobId: removal.id });
      await expect(finish(removal.id, [[held, "RETURNED"]])).rejects.toThrow(/different customer/);
      expect(await status(held)).toBe("RENTED");
    } finally {
      await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: held } });
      await prisma.jobAppliance.deleteMany({ where: { jobId: removal.id } });
      await prisma.job.deleteMany({ where: { id: removal.id } });
      jobIds.splice(jobIds.indexOf(removal.id), 1);
      await prisma.applianceAssignment.deleteMany({ where: { applianceId: held } });
      await prisma.appliance.deleteMany({ where: { id: held } });
      applianceIds.splice(applianceIds.indexOf(held), 1);
      await prisma.customer.deleteMany({ where: { id: otherCustomer } });
      await prisma.user.deleteMany({ where: { id: otherUser } });
    }
  });

  it("complete-backdated-return-refused: a return dated before the delivery changes nothing", async () => {
    const a = await unit("RESERVED");
    const d = await job("DELIVERY", [a]);
    await finish(d.id, [[a, "DELIVERED"]]);
    const r = await job("REMOVAL", [a]);
    await expect(finish(r.id, [[a, "RETURNED"]], { performedOn: businessDateFromKey("2026-09-01") })).rejects.toThrow(/before the date/);
    expect(await status(a)).toBe("RENTED");
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: a, closedAt: null } })).toBe(1);
  });

  it("complete-delivery-without-customer-refused: a delivery with no customer changes nothing", async () => {
    const a = await unit("RESERVED", false);
    const j = await job("DELIVERY", [a], { customerId: null, agreementId: null, serviceAddressId: null });
    await expect(finish(j.id, [[a, "DELIVERED"]])).rejects.toThrow(/no customer/);
    expect(await status(a)).toBe("RESERVED");
    expect((await jobRow(j.id)).status).toBe("IN_PROGRESS");
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: a } })).toBe(0);
  });

  it("a swap takes a result per unit; returning the old unit without the new one being delivered is refused", async () => {
    const original = await unit("RENTED");
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
    const racedApplianceIds: string[] = [];
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
      racedApplianceIds.push(u);
      await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: u } });
      const setup = await job("DELIVERY", [u], { status: "COMPLETED", agreementId: agId });
      await prisma.$transaction((tx) => openCustodyEpisodeInTx(tx, { applianceId: u, customerId, serviceAddressId: addressId, agreementId: agId, startedOn: new Date("2026-08-01T06:00:00Z"), startJobId: setup.id }));
      const removal = await job("REMOVAL", [u], { agreementId: agId });
      const settled = await Promise.allSettled([
        completeJob(ownerId, { jobId: removal.id, expectedVersion: 1, completionKey: key(), performedOn: businessDateFromKey("2026-09-12"), completionNotes: null, results: [{ applianceId: u, result: "RETURNED" }] }),
        executeAgreedTermination(agId, new Date("2026-09-12T18:00:00Z")),
      ]);
      expect(settled.some((x) => x.status === "fulfilled")).toBe(true);
    }
    const raced = new Set(racedApplianceIds);
    expect((await findCustodyInvariantViolations(prisma)).filter((violation) => raced.has(violation.applianceId))).toEqual([]);
  });
});
