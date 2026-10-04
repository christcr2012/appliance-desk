import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));

import { prisma } from "@/lib/prisma";
import { completeJob, updateJobStatus } from "@/domains/jobs";
import { markJobNoShow } from "@/domains/jobs/scheduling";
import { scheduleMaintenanceRequest } from "@/domains/maintenance";
import { businessDateFromKey } from "@/lib/business-date";
import type { MaintenanceStatus } from "@prisma/client";

// The maintenance request follows its repair visit (Batch C, P2-D), real Postgres.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("maintenance request chain", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `mc-owner-${tag}`;
  const userId = `mc-user-${tag}`;
  const customerId = `mc-customer-${tag}`;
  const addressId = `mc-address-${tag}`;
  const otherUserId = `mc-user2-${tag}`;
  const otherCustomerId = `mc-customer2-${tag}`;
  const otherAddressId = `mc-address2-${tag}`;
  const typeId = `mc-type-${tag}`;
  const requestIds: string[] = [];
  const applianceIds: string[] = [];
  const jobIds: string[] = [];
  let counter = 0;

  async function request(status: MaintenanceStatus, withAppliance = true) {
    const id = `mc-req-${counter++}-${tag}`;
    requestIds.push(id);
    let applianceId: string | null = null;
    if (withAppliance) {
      applianceId = `mc-unit-${applianceIds.length}-${tag}`;
      applianceIds.push(applianceId);
      await prisma.appliance.create({ data: { id: applianceId, assetNumber: `MC${applianceIds.length}-${tag.slice(0, 8)}`, applianceTypeId: typeId, status: "RENTED" } });
    }
    await prisma.maintenanceRequest.create({ data: { id, customerId, applianceId, problem: "Won't drain", status } });
    return { id, applianceId };
  }
  const state = async (id: string) => (await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id } })).status;
  const when = () => new Date(Date.now() + 86_400_000);
  async function schedule(requestId: string) {
    const { jobId } = await scheduleMaintenanceRequest(ownerId, { requestId, scheduledAt: when(), durationMinutes: 60, assignedToUserId: null, serviceAddressId: addressId, confirmedConflictJobIds: [] });
    jobIds.push(jobId);
    return jobId;
  }
  const finish = async (jobId: string, results: Array<[string, "REPAIRED" | "NOT_REPAIRED" | "NO_ACCESS"]>) =>
    completeJob(ownerId, { jobId, expectedVersion: (await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).version, completionKey: `mc-key-${randomUUID()}`, performedOn: businessDateFromKey("2026-09-12"), completionNotes: null, results: results.map(([applianceId, result]) => ({ applianceId, result })) });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "MC Owner", role: "OWNER", emailVerified: true },
        { id: userId, email: `${tag}-c@example.test`, name: "MC Customer", role: "CUSTOMER", emailVerified: true },
        { id: otherUserId, email: `${tag}-c2@example.test`, name: "MC Customer 2", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.createMany({ data: [{ id: customerId, userId, referralCode: `M${tag.slice(0, 18)}` }, { id: otherCustomerId, userId: otherUserId, referralCode: `N${tag.slice(0, 18)}` }] });
    await prisma.serviceAddress.createMany({ data: [{ id: addressId, customerId, line1: "1 Repair St", city: "Greeley", zip: "80631" }, { id: otherAddressId, customerId: otherCustomerId, line1: "2 Other St", city: "Greeley", zip: "80631" }] });
    await prisma.applianceType.create({ data: { id: typeId, name: `MC ${tag}`, slug: `mc-${tag}` } });
  });

  afterAll(async () => {
    await prisma.staffTask.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ userId: ownerId }, { entityType: "MaintenanceRequest", entityId: { in: requestIds } }, { entityType: "Job", entityId: { in: jobIds } }, { entityType: "Appliance", entityId: { in: applianceIds } }] },
    });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.maintenanceRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: { in: [addressId, otherAddressId] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [customerId, otherCustomerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId, otherUserId] } } });
  });

  it("maintenance-schedule-one-transaction: the request, the visit and the property are set together", async () => {
    const r = await request("REVIEWING");
    const jobId = await schedule(r.id);
    expect(await state(r.id)).toBe("SCHEDULED");
    expect((await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: r.id } })).serviceAddressId).toBe(addressId);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: { appliances: true } });
    expect(job).toMatchObject({ type: "MAINTENANCE_VISIT", customerId, serviceAddressId: addressId, maintenanceRequestId: r.id });
    expect(job.appliances.map((a) => a.applianceId)).toEqual([r.applianceId]);
  });

  it("maintenance-schedule-rolls-back: a refused visit leaves the request as it was", async () => {
    const r = await request("REVIEWING");
    await expect(scheduleMaintenanceRequest(ownerId, { requestId: r.id, scheduledAt: when(), durationMinutes: 60, assignedToUserId: null, serviceAddressId: otherAddressId, confirmedConflictJobIds: [] })).rejects.toThrow(/service address belonging to this customer/);
    expect(await state(r.id)).toBe("REVIEWING");
    expect(await prisma.job.count({ where: { maintenanceRequestId: r.id } })).toBe(0);
    expect((await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: r.id } })).serviceAddressId).toBeNull();
  });

  it("maintenance-schedule-refusals: only a reviewed request, and only one waiting visit", async () => {
    const submitted = await request("SUBMITTED");
    await expect(scheduleMaintenanceRequest(ownerId, { requestId: submitted.id, scheduledAt: when(), durationMinutes: null, assignedToUserId: null, serviceAddressId: addressId, confirmedConflictJobIds: [] })).rejects.toThrow(/Review this request first/);
    const scheduled = await request("REVIEWING");
    await schedule(scheduled.id);
    await expect(scheduleMaintenanceRequest(ownerId, { requestId: scheduled.id, scheduledAt: when(), durationMinutes: null, assignedToUserId: null, serviceAddressId: addressId, confirmedConflictJobIds: [] })).rejects.toThrow(/already scheduled/);
    const done = await request("RESOLVED");
    await expect(scheduleMaintenanceRequest(ownerId, { requestId: done.id, scheduledAt: when(), durationMinutes: null, assignedToUserId: null, serviceAddressId: addressId, confirmedConflictJobIds: [] })).rejects.toThrow(/already finished/);
  });

  it("maintenance-schedule-race: two people scheduling the same request create one visit", async () => {
    const r = await request("REVIEWING");
    const results = await Promise.allSettled([schedule(r.id), schedule(r.id)]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.job.count({ where: { maintenanceRequestId: r.id } })).toBe(1);
  });

  it("maintenance-visit-lifecycle: starting moves it to in progress; a fully repaired visit resolves it", async () => {
    const r = await request("REVIEWING");
    const jobId = await schedule(r.id);
    await updateJobStatus(ownerId, jobId, "IN_PROGRESS");
    expect(await state(r.id)).toBe("IN_PROGRESS");
    const done = await finish(jobId, [[r.applianceId!, "REPAIRED"]]);
    expect(done.outcome).toBe("COMPLETE");
    const row = await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe("RESOLVED");
    expect(row.completedAt).not.toBeNull();
  });

  it("maintenance-not-finished-never-resolves: not repaired or no access sends it back to reviewing with a task", async () => {
    for (const result of ["NOT_REPAIRED", "NO_ACCESS"] as const) {
      const r = await request("REVIEWING");
      const jobId = await schedule(r.id);
      await updateJobStatus(ownerId, jobId, "IN_PROGRESS");
      const done = await finish(jobId, [[r.applianceId!, result]]);
      expect(done.outcome).toBe("PARTIAL");
      expect(await state(r.id)).toBe("REVIEWING");
      expect(await prisma.staffTask.count({ where: { jobId, priority: "HIGH" } })).toBe(1);
    }
  });

  it("maintenance-cancel-and-no-show: back to reviewing, unless another visit is still open", async () => {
    const r = await request("REVIEWING");
    const first = await schedule(r.id);
    await updateJobStatus(ownerId, first, "CANCELLED");
    expect(await state(r.id)).toBe("REVIEWING");
    const second = await schedule(r.id);
    await markJobNoShow(ownerId, second, 1);
    expect(await state(r.id)).toBe("REVIEWING");

    // A second visit while the first is still open keeps the request where it is.
    const busy = await request("REVIEWING");
    const visitOne = await schedule(busy.id);
    await updateJobStatus(ownerId, visitOne, "IN_PROGRESS");
    expect(await state(busy.id)).toBe("IN_PROGRESS");
    const visitTwo = await schedule(busy.id);
    expect(await state(busy.id)).toBe("IN_PROGRESS");
    await updateJobStatus(ownerId, visitTwo, "CANCELLED");
    expect(await state(busy.id)).toBe("IN_PROGRESS");
  });

  it("maintenance-address-backfill: filled only when the customer has exactly one address", async () => {
    const migration = (await import("node:fs")).readFileSync("prisma/migrations/20261003370000_maintenance_links/migration.sql", "utf8");
    const update = migration.split(";").map((s) => s.replace(/--.*$/gm, "").trim()).find((s) => s.startsWith("UPDATE"))!;
    const one = await request("REVIEWING", false);
    const many = await request("REVIEWING", false);
    await prisma.serviceAddress.create({ data: { id: `mc-extra-${tag}`, customerId, line1: "3 Extra St", city: "Greeley", zip: "80631" } });
    // The shared customer now has two addresses; the other customer has one.
    await prisma.maintenanceRequest.update({ where: { id: one.id }, data: { customerId: otherCustomerId } });
    await prisma.$executeRawUnsafe(`${update} WHERE "id" IN ('${one.id}', '${many.id}')`);
    expect((await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: one.id } })).serviceAddressId).toBe(otherAddressId);
    expect((await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: many.id } })).serviceAddressId).toBeNull();
    await prisma.serviceAddress.deleteMany({ where: { id: `mc-extra-${tag}` } });
  });
});
