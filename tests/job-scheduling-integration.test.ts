import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createJob } from "@/domains/jobs";
import { JobScheduleConflictError, JobVersionError, markJobNoShow, scheduleJob } from "@/domains/jobs/scheduling";
import { businessDateTimeFromLocal } from "@/lib/business-date";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const at = (local: string) => businessDateTimeFromLocal(local)!;

// Batch C P1-A: double-booking is checked per person under a lock on that person; real Postgres.
describe.skipIf(!enabled)("job scheduling (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `sch-owner-${tag}`;
  const staffA = `sch-a-${tag}`;
  const staffB = `sch-b-${tag}`;
  const staffC = `sch-c-${tag}`;
  const jobIds: string[] = [];

  async function newJob(opts: { local: string; minutes: number | null; assignee: string | null; status?: "SCHEDULED" | "IN_PROGRESS" }) {
    const job = await prisma.job.create({
      data: {
        type: "MAINTENANCE_VISIT",
        status: opts.status ?? "SCHEDULED",
        scheduledAt: at(opts.local),
        durationMinutes: opts.minutes,
        assignedToUserId: opts.assignee,
      },
    });
    jobIds.push(job.id);
    return job;
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "Owner", role: "OWNER" },
        { id: staffA, email: `${tag}-a@example.test`, name: "Staff A", role: "STAFF" },
        { id: staffB, email: `${tag}-b@example.test`, name: "Staff B", role: "STAFF" },
        { id: staffC, email: `${tag}-c@example.test`, name: "Staff C", role: "STAFF" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [ownerId, staffA, staffB, staffC] } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffA, staffB, staffC] } } });
  });

  async function moveInto(jobId: string, local: string, assignee: string | null, minutes: number | null, confirmed: string[] = []) {
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { version: true } });
    return scheduleJob(ownerId, {
      jobId,
      expectedVersion: job.version,
      scheduledAt: at(local),
      durationMinutes: minutes,
      assignedToUserId: assignee,
      confirmedConflictJobIds: confirmed,
    });
  }

  it("schedule-half-open-back-to-back-ok: a visit that ends exactly when the next starts does not conflict", async () => {
    await newJob({ local: "2031-05-12T09:00", minutes: 60, assignee: staffA });
    const next = await newJob({ local: "2031-05-12T12:00", minutes: 60, assignee: null });
    await expect(moveInto(next.id, "2031-05-12T10:00", staffA, 60)).resolves.toMatchObject({ overriddenConflictJobIds: [] });
    const overlap = await newJob({ local: "2031-05-12T14:00", minutes: 60, assignee: null });
    await expect(moveInto(overlap.id, "2031-05-12T09:59", staffA, 60)).rejects.toBeInstanceOf(JobScheduleConflictError);
  });

  it("only conflicts with the same person; completed and cancelled visits free the time", async () => {
    await newJob({ local: "2031-05-13T09:00", minutes: 60, assignee: staffA });
    await newJob({ local: "2031-05-13T09:00", minutes: 60, assignee: staffA, status: "SCHEDULED" }).then((j) =>
      prisma.job.update({ where: { id: j.id }, data: { status: "CANCELLED" } }),
    );
    const other = await newJob({ local: "2031-05-13T15:00", minutes: 60, assignee: null });
    await expect(moveInto(other.id, "2031-05-13T09:30", staffB, 60)).resolves.toBeDefined();
    const done = await newJob({ local: "2031-05-14T09:00", minutes: 60, assignee: staffA });
    await prisma.job.update({ where: { id: done.id }, data: { status: "COMPLETED" } });
    const later = await newJob({ local: "2031-05-14T15:00", minutes: 60, assignee: null });
    await expect(moveInto(later.id, "2031-05-14T09:30", staffA, 60)).resolves.toBeDefined();
  });

  it("schedule-detects-job-crossing-midnight-from-previous-denver-day", async () => {
    await newJob({ local: "2031-06-01T23:00", minutes: 240, assignee: staffA }); // runs until 03:00 next day
    const next = await newJob({ local: "2031-06-05T10:00", minutes: 30, assignee: null });
    await expect(moveInto(next.id, "2031-06-02T01:00", staffA, 30)).rejects.toBeInstanceOf(JobScheduleConflictError);
    await expect(moveInto(next.id, "2031-06-02T03:00", staffA, 30)).resolves.toBeDefined();
  });

  it("schedule-spring-forward-2026-03-08: elapsed time, not the wall clock, decides", async () => {
    // 01:30 MST + 120 minutes ends at 04:30 MDT. A 03:30 MDT visit starts one real hour after the first begins.
    await newJob({ local: "2026-03-08T01:30", minutes: 120, assignee: staffC });
    const probe = await newJob({ local: "2026-03-20T10:00", minutes: 30, assignee: null });
    await expect(moveInto(probe.id, "2026-03-08T03:30", staffC, 30)).rejects.toBeInstanceOf(JobScheduleConflictError);
    await expect(moveInto(probe.id, "2026-03-08T04:30", staffC, 30)).resolves.toBeDefined();
  });

  it("schedule-fall-back-2026-11-01: the repeated hour is two real hours", async () => {
    // 01:30 MDT (first) + 90 minutes ends at 01:00 MST (the repeated hour); 01:30 MST is the second 01:30.
    await newJob({ local: "2026-11-01T00:30", minutes: 150, assignee: staffC }); // 06:30Z .. 09:00Z
    const probe = await newJob({ local: "2026-11-20T10:00", minutes: 30, assignee: null });
    await expect(moveInto(probe.id, "2026-11-01T01:30", staffC, 30)).rejects.toBeInstanceOf(JobScheduleConflictError); // 07:30Z
    await expect(moveInto(probe.id, "2026-11-01T02:00", staffC, 30)).resolves.toBeDefined(); // 09:00Z, back-to-back
  });

  it("schedule-two-concurrent-jobs-same-person-one-wins", async () => {
    const a = await newJob({ local: "2031-07-01T08:00", minutes: 60, assignee: null });
    const b = await newJob({ local: "2031-07-02T08:00", minutes: 60, assignee: null });
    const results = await Promise.allSettled([
      moveInto(a.id, "2031-07-10T09:00", staffB, 60),
      moveInto(b.id, "2031-07-10T09:30", staffB, 60),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(JobScheduleConflictError);
  });

  it("schedule-reassign-locks-both-people-in-id-order-no-deadlock", async () => {
    // Two visits swap people at the same moment: A->B and B->A. Both lock {A,B}; id order means no deadlock.
    const x = await newJob({ local: "2031-08-01T09:00", minutes: 60, assignee: staffA });
    const y = await newJob({ local: "2031-08-02T09:00", minutes: 60, assignee: staffB });
    const results = await Promise.allSettled([
      moveInto(x.id, "2031-08-01T09:00", staffB, 60),
      moveInto(y.id, "2031-08-02T09:00", staffA, 60),
    ]);
    for (const r of results) {
      if (r.status === "rejected") expect(String(r.reason)).not.toMatch(/deadlock/i);
    }
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("schedule-stale-confirmation-cannot-approve-new-conflict", async () => {
    const first = await newJob({ local: "2031-09-01T09:00", minutes: 60, assignee: staffC });
    const target = await newJob({ local: "2031-09-20T09:00", minutes: 60, assignee: null });
    let seen: string[] = [];
    try {
      await moveInto(target.id, "2031-09-01T09:30", staffC, 60);
    } catch (error) {
      expect(error).toBeInstanceOf(JobScheduleConflictError);
      seen = (error as JobScheduleConflictError).conflicts.map((c) => c.jobId);
    }
    expect(seen).toEqual([first.id]);
    // Someone books a second overlapping visit before the person confirms the first one.
    const second = await newJob({ local: "2031-09-01T09:45", minutes: 30, assignee: staffC });
    await expect(moveInto(target.id, "2031-09-01T09:30", staffC, 60, seen)).rejects.toMatchObject({
      conflicts: expect.arrayContaining([expect.objectContaining({ jobId: second.id })]),
    });
    const ok = await moveInto(target.id, "2031-09-01T09:30", staffC, 60, [first.id, second.id]);
    expect(ok.overriddenConflictJobIds.sort()).toEqual([first.id, second.id].sort());
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: target.id, action: "job.schedule" }, orderBy: { createdAt: "desc" } });
    expect((audit.newValue as { overriddenConflictJobIds: string[] }).overriddenConflictJobIds).toHaveLength(2);
  });

  it("schedule-stale-version-rejected", async () => {
    const job = await newJob({ local: "2031-10-01T09:00", minutes: 60, assignee: null });
    await scheduleJob(ownerId, {
      jobId: job.id, expectedVersion: 1, scheduledAt: at("2031-10-01T10:00"), durationMinutes: 60, assignedToUserId: null, confirmedConflictJobIds: [],
    });
    await expect(
      scheduleJob(ownerId, {
        jobId: job.id, expectedVersion: 1, scheduledAt: at("2031-10-01T11:00"), durationMinutes: 60, assignedToUserId: null, confirmedConflictJobIds: [],
      }),
    ).rejects.toBeInstanceOf(JobVersionError);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).version).toBe(2);
  });

  it("moving a visit to another Colorado day re-arms its day-of reminder; a same-day time change keeps it", async () => {
    const job = await newJob({ local: "2031-11-05T09:00", minutes: 60, assignee: null });
    await prisma.job.update({ where: { id: job.id }, data: { dayOfReminderSentAt: new Date("2031-11-05T13:00:00Z") } });
    await moveInto(job.id, "2031-11-05T15:00", null, 60);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).dayOfReminderSentAt).not.toBeNull();
    await moveInto(job.id, "2031-11-06T09:00", null, 60);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).dayOfReminderSentAt).toBeNull();
  });

  it("schedule-null-duration-uses-owner-default", async () => {
    const before = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { defaultJobDurationMinutes: true } });
    await prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", defaultJobDurationMinutes: 30 }, update: { defaultJobDurationMinutes: 30 } });
    try {
      await newJob({ local: "2031-11-01T09:00", minutes: null, assignee: staffA });
      const probe = await newJob({ local: "2031-11-20T09:00", minutes: 15, assignee: null });
      await expect(moveInto(probe.id, "2031-11-01T09:45", staffA, 15)).resolves.toBeDefined(); // default 30: free at 09:30
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: { defaultJobDurationMinutes: 120 } });
      const probe2 = await newJob({ local: "2031-11-21T09:00", minutes: 15, assignee: null });
      await expect(moveInto(probe2.id, "2031-11-01T10:30", staffA, 15)).rejects.toBeInstanceOf(JobScheduleConflictError);
    } finally {
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: { defaultJobDurationMinutes: before?.defaultJobDurationMinutes ?? 120 } });
    }
  });

  it("refuses an inactive or non-team assignee, a bad duration and a non-admin scheduler", async () => {
    const job = await newJob({ local: "2031-12-01T09:00", minutes: 60, assignee: null });
    const customerUser = await prisma.user.create({ data: { id: `sch-cust-${tag}`, email: `${tag}-cust@example.test`, role: "CUSTOMER" } });
    const archived = await prisma.user.create({ data: { id: `sch-arch-${tag}`, email: `${tag}-arch@example.test`, role: "STAFF", archivedAt: new Date() } });
    const base = { jobId: job.id, expectedVersion: 1, scheduledAt: at("2031-12-01T09:00"), durationMinutes: 60, confirmedConflictJobIds: [] as string[] };
    try {
      await expect(scheduleJob(ownerId, { ...base, assignedToUserId: customerUser.id })).rejects.toThrow(/active team member/);
      await expect(scheduleJob(ownerId, { ...base, assignedToUserId: archived.id })).rejects.toThrow(/active team member/);
      await expect(scheduleJob(ownerId, { ...base, durationMinutes: 5, assignedToUserId: null })).rejects.toThrow(/between 15 and 720/);
      await expect(scheduleJob(staffA, { ...base, assignedToUserId: null })).rejects.toThrow(/no longer has access/);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [customerUser.id, archived.id] } } });
    }
  });

  it("createJob checks conflicts for the assignee and saves duration and assignee", async () => {
    await newJob({ local: "2032-01-10T09:00", minutes: 60, assignee: staffB });
    await expect(
      createJob(ownerId, { type: "MAINTENANCE_VISIT", scheduledAt: at("2032-01-10T09:30"), assignedToUserId: staffB, durationMinutes: 30 }),
    ).rejects.toBeInstanceOf(JobScheduleConflictError);
    const created = await createJob(ownerId, { type: "MAINTENANCE_VISIT", scheduledAt: at("2032-01-10T10:00"), assignedToUserId: staffB, durationMinutes: 30 });
    jobIds.push(created.id);
    expect(created).toMatchObject({ assignedToUserId: staffB, durationMinutes: 30, version: 1 });
  });

  it("no-show-clears-schedule-leaves-custody-inventory-billing", async () => {
    const typeId = `sch-type-${tag}`;
    const applianceId = `sch-app-${tag}`;
    await prisma.applianceType.create({ data: { id: typeId, name: `NS ${tag}`, slug: `ns-${tag}`, monthlyPriceCents: 3000 } });
    await prisma.appliance.create({ data: { id: applianceId, assetNumber: `NS-${tag.slice(0, 8)}`, applianceTypeId: typeId, status: "RESERVED" } });
    try {
      const job = await prisma.job.create({
        data: {
          type: "DELIVERY", status: "SCHEDULED", scheduledAt: at("2032-02-01T09:00"), durationMinutes: 60, assignedToUserId: staffA,
          appliances: { create: [{ applianceId }] },
        },
      });
      jobIds.push(job.id);
      const creditsBefore = await prisma.customerCredit.count();
      await expect(markJobNoShow(staffB, job.id, 1)).rejects.toThrow(/assigned to this visit/);
      await expect(markJobNoShow(staffA, job.id, 5)).rejects.toBeInstanceOf(JobVersionError);
      await expect(markJobNoShow(staffA, job.id, 1)).resolves.toEqual({ version: 2 });
      const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(after).toMatchObject({ status: "CANCELLED", version: 2, assignedToUserId: staffA });
      expect(after.noShowAt).not.toBeNull();
      expect((await prisma.appliance.findUniqueOrThrow({ where: { id: applianceId } })).status).toBe("RESERVED");
      expect(await prisma.pendingDelivery.count({ where: { applianceId } })).toBe(0);
      expect(await prisma.customerCredit.count()).toBe(creditsBefore);
      // A second no-show, or one on a finished visit, is refused.
      await expect(markJobNoShow(ownerId, job.id, 2)).rejects.toThrow(/scheduled or in progress/);
      // The person's time is free again.
      const probe = await newJob({ local: "2032-02-10T09:00", minutes: 30, assignee: null });
      await expect(moveInto(probe.id, "2032-02-01T09:15", staffA, 30)).resolves.toBeDefined();
    } finally {
      await prisma.jobAppliance.deleteMany({ where: { applianceId } });
      await prisma.auditLog.deleteMany({ where: { entityId: applianceId } });
      await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
      await prisma.appliance.deleteMany({ where: { id: applianceId } });
      await prisma.applianceType.deleteMany({ where: { id: typeId } });
    }
  });
});
