import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));

import { prisma } from "@/lib/prisma";
import { addJobPhoto, completeJob, updateJobChecklist, updateJobStatus } from "@/domains/jobs";
import { markJobNoShow } from "@/domains/jobs/scheduling";
import { updateApplianceStatusAsTeamActor } from "@/domains/inventory/guarded-status";
import { updateApplianceStatus } from "@/domains/inventory";
import { businessDateFromKey } from "@/lib/business-date";

// Job-scoped staff authority (Batch C, P2-E), real Postgres. Owners and admins work any job; staff only
// jobs that are scheduled or in progress, assigned to them (or to nobody when the owner's setting allows),
// and only the appliances on that job.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("job scope", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `js-owner-${tag}`;
  const staffId = `js-staff-${tag}`;
  const otherStaffId = `js-staff2-${tag}`;
  const typeId = `js-type-${tag}`;
  const applianceIds: string[] = [];
  const jobIds: string[] = [];
  let originalSetting = true;

  async function job(over: { assignedToUserId?: string | null; status?: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"; withUnit?: boolean } = {}) {
    const created = await prisma.job.create({
      data: { type: "REMOVAL", status: over.status ?? "IN_PROGRESS", assignedToUserId: over.assignedToUserId === undefined ? staffId : over.assignedToUserId, scheduledAt: new Date() },
    });
    jobIds.push(created.id);
    let applianceId: string | null = null;
    if (over.withUnit !== false) {
      applianceId = `js-unit-${applianceIds.length}-${tag}`;
      applianceIds.push(applianceId);
      await prisma.appliance.create({ data: { id: applianceId, assetNumber: `JS${applianceIds.length}-${tag.slice(0, 8)}`, applianceTypeId: typeId, status: "AVAILABLE" } });
      await prisma.jobAppliance.create({ data: { jobId: created.id, applianceId } });
    }
    return { id: created.id, applianceId: applianceId! };
  }
  const setting = (value: boolean) =>
    prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", staffMayWorkUnassignedJobs: value }, update: { staffMayWorkUnassignedJobs: value } });

  beforeAll(async () => {
    originalSetting = (await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { staffMayWorkUnassignedJobs: true } }))?.staffMayWorkUnassignedJobs ?? true;
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "JS Owner", role: "OWNER", emailVerified: true },
        { id: staffId, email: `${tag}-s@example.test`, name: "JS Staff", role: "STAFF", emailVerified: true },
        { id: otherStaffId, email: `${tag}-s2@example.test`, name: "JS Staff Two", role: "STAFF", emailVerified: true },
      ],
    });
    await prisma.applianceType.create({ data: { id: typeId, name: `JS ${tag}`, slug: `js-${tag}` } });
  });

  afterAll(async () => {
    await setting(originalSetting);
    await prisma.photo.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: [ownerId, staffId, otherStaffId] } }, { entityType: "Appliance", entityId: { in: applianceIds } }, { entityType: "Job", entityId: { in: jobIds } }] } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, otherStaffId] } } });
  });

  it("scope-assigned: the assigned staff member can work the job and another staff member cannot", async () => {
    await setting(true);
    const mine = await job({ status: "SCHEDULED" });
    await expect(updateJobStatus(otherStaffId, mine.id, "IN_PROGRESS")).rejects.toThrow(/assigned to someone else/);
    await expect(addJobPhoto(otherStaffId, mine.id, { url: "https://example.test/a.jpg" })).rejects.toThrow(/assigned to someone else/);
    await expect(updateJobChecklist(otherStaffId, mine.id, [{ item: "x", checked: true }])).rejects.toThrow(/assigned to someone else/);
    await expect(markJobNoShow(otherStaffId, mine.id, 1)).rejects.toThrow(/assigned to someone else/);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe("SCHEDULED");
    expect((await updateJobStatus(staffId, mine.id, "IN_PROGRESS")).status).toBe("IN_PROGRESS");
    await addJobPhoto(staffId, mine.id, { url: "https://example.test/b.jpg" });
    await updateJobChecklist(staffId, mine.id, [{ item: "x", checked: true }]);
  });

  it("scope-unassigned-setting: an unassigned job is open to staff only while the owner's setting is on", async () => {
    const open = await job({ assignedToUserId: null, status: "SCHEDULED" });
    await setting(false);
    await expect(updateJobStatus(staffId, open.id, "IN_PROGRESS")).rejects.toThrow(/assigned to them/);
    await expect(addJobPhoto(staffId, open.id, { url: "https://example.test/c.jpg" })).rejects.toThrow(/assigned to them/);
    // An owner is never held back by the setting.
    expect((await updateJobStatus(ownerId, open.id, "IN_PROGRESS")).status).toBe("IN_PROGRESS");
    await setting(true);
    const open2 = await job({ assignedToUserId: null, status: "SCHEDULED" });
    expect((await updateJobStatus(staffId, open2.id, "IN_PROGRESS")).status).toBe("IN_PROGRESS");
    const noShow = await job({ assignedToUserId: null, status: "SCHEDULED" });
    await markJobNoShow(staffId, noShow.id, 1);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: noShow.id } })).status).toBe("CANCELLED");
  });

  it("scope-finished-jobs: staff cannot work a completed or cancelled job, only add photos to a completed one, and nobody edits its checklist", async () => {
    await setting(true);
    const done = await job({ status: "COMPLETED" });
    const cancelled = await job({ status: "CANCELLED" });
    await expect(updateJobChecklist(staffId, done.id, [{ item: "x", checked: true }])).rejects.toThrow(/scheduled or in progress/);
    await expect(updateJobStatus(staffId, cancelled.id, "SCHEDULED")).rejects.toThrow(/scheduled or in progress/);
    await expect(addJobPhoto(staffId, cancelled.id, { url: "https://example.test/d.jpg" })).rejects.toThrow(/scheduled or in progress/);
    await addJobPhoto(staffId, done.id, { url: "https://example.test/e.jpg" });
    // The record rule holds for owners too.
    await expect(updateJobChecklist(ownerId, done.id, [{ item: "x", checked: true }])).rejects.toThrow(/can't be changed/);
    await expect(updateJobChecklist(ownerId, cancelled.id, [{ item: "x", checked: true }])).rejects.toThrow(/can't be changed/);
  });

  it("scope-completion: staff cannot complete someone else's job, and nothing about it changes", async () => {
    await setting(true);
    const theirs = await job({ assignedToUserId: otherStaffId });
    await expect(
      completeJob(staffId, { jobId: theirs.id, expectedVersion: 1, completionKey: `key-${randomUUID()}`, performedOn: businessDateFromKey("2026-09-12"), completionNotes: null, results: [{ applianceId: theirs.applianceId, result: "RETURNED" }] }),
    ).rejects.toThrow(/assigned to someone else/);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({ status: "IN_PROGRESS", version: 1 });
    expect((await prisma.jobAppliance.findFirstOrThrow({ where: { jobId: theirs.id } })).result).toBeNull();
  });

  it("scope-appliance-status: staff change an appliance's status only from a job they may work, and only an appliance on that job", async () => {
    await setting(true);
    const mine = await job();
    const stranger = await job({ assignedToUserId: otherStaffId });
    await expect(updateApplianceStatusAsTeamActor(staffId, mine.applianceId, "MAINTENANCE")).rejects.toThrow(/not linked/);
    await expect(updateApplianceStatusAsTeamActor(staffId, stranger.applianceId, "MAINTENANCE", mine.id)).rejects.toThrow(/not linked/);
    await expect(updateApplianceStatusAsTeamActor(staffId, stranger.applianceId, "MAINTENANCE", stranger.id)).rejects.toThrow(/assigned to someone else/);
    await updateApplianceStatusAsTeamActor(staffId, mine.applianceId, "MAINTENANCE", mine.id);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: mine.applianceId } })).status).toBe("MAINTENANCE");
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: stranger.applianceId } })).status).toBe("AVAILABLE");
  });

  it("scope-owner-only-status: the plain status change and bulk change refuse staff", async () => {
    const mine = await job();
    await expect(updateApplianceStatus(staffId, mine.applianceId, "MAINTENANCE")).rejects.toThrow(/no longer has access/);
    await updateApplianceStatus(ownerId, mine.applianceId, "MAINTENANCE");
  });
});
