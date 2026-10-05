import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  amendApplianceInspection,
  checklistHash,
  ChecklistVersionError,
  getInspectionChecklist,
  recordApplianceInspection,
} from "@/domains/inventory/guided-actions";
import { publishChecklistVersion } from "@/domains/inventory/checklist-versions";

// Inspections (Batch C, P2-E), real Postgres: the checklist is versioned and stored with each inspection,
// the result is worked out on the server, an override is owner/admin only, and records cannot be changed.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("inspections", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `in-owner-${tag}`;
  const adminId = `in-admin-${tag}`;
  const staffId = `in-staff-${tag}`;
  const typeId = `in-type-${tag}`;
  const applianceIds: string[] = [];

  async function waiting() {
    const id = `in-unit-${applianceIds.length}-${tag}`;
    applianceIds.push(id);
    await prisma.appliance.create({ data: { id, assetNumber: `IN${applianceIds.length}-${tag.slice(0, 8)}`, applianceTypeId: typeId, status: "AWAITING_INSPECTION" } });
    return id;
  }
  const statusOf = async (id: string) => (await prisma.appliance.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "IN Owner", role: "OWNER", emailVerified: true },
        { id: adminId, email: `${tag}-a@example.test`, name: "IN Admin", role: "ADMIN", emailVerified: true },
        { id: staffId, email: `${tag}-s@example.test`, name: "IN Staff", role: "STAFF", emailVerified: true },
      ],
    });
    await prisma.applianceType.create({ data: { id: typeId, name: `IN ${tag}`, slug: `in-${tag}` } });
  });

  afterAll(async () => {
    // Inspections are append-only, so a test cleanup has to switch the rule off for its own rows, in one transaction.
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "ApplianceInspection" DISABLE TRIGGER "ApplianceInspection_append_only"'),
      prisma.applianceInspectionAmendment.deleteMany({ where: { inspection: { applianceId: { in: applianceIds } } } }),
      prisma.applianceInspection.deleteMany({ where: { applianceId: { in: applianceIds } } }),
      prisma.$executeRawUnsafe('ALTER TABLE "ApplianceInspection" ENABLE TRIGGER "ApplianceInspection_append_only"'),
    ]);
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: [ownerId, adminId, staffId] } }, { entityType: "Appliance", entityId: { in: applianceIds } }] } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, staffId] } } });
  });

  it("inspection-seed-version: version 1 exists and its hash is the sha256 of the compact JSON of its items", async () => {
    const v1 = await prisma.inspectionChecklistVersion.findUniqueOrThrow({ where: { version: 1 } });
    expect(v1.publishedByUserId).toBeNull();
    expect(v1.hash).toBe(checklistHash(v1.items as string[]));
    const current = await getInspectionChecklist();
    expect(current.items.length).toBeGreaterThan(0);
  });

  it("inspection-published-version: publishing affects future inspections only and a stale form is refused", async () => {
    const before = await getInspectionChecklist();
    const inspectedUnit = await waiting();
    const completed = await recordApplianceInspection(ownerId, inspectedUnit, {
      expectedChecklistVersionId: before.versionId,
      answers: before.items.map(() => true),
    });

    const nextItems = before.items.map((item, index) => index === 0 ? `${item} — current policy` : item);
    const published = await publishChecklistVersion(ownerId, nextItems);
    const after = await getInspectionChecklist();
    expect(after.versionId).toBe(published.versionId);
    expect(after.version).toBe(published.version);
    expect(after.items).toEqual(nextItems);

    const saved = await prisma.applianceInspection.findUniqueOrThrow({ where: { id: completed.inspectionId } });
    expect(saved.checklistVersionId).toBe(before.versionId);
    expect(saved.checklistDefinition).toEqual(before.items);

    const staleUnit = await waiting();
    await expect(recordApplianceInspection(ownerId, staleUnit, {
      expectedChecklistVersionId: before.versionId,
      answers: before.items.map(() => true),
    })).rejects.toBeInstanceOf(ChecklistVersionError);
    expect(await prisma.applianceInspection.count({ where: { applianceId: staleUnit } })).toBe(0);

    await expect(publishChecklistVersion(staffId, nextItems.map((item) => `${item} staff`))).rejects.toThrow();
    await expect(publishChecklistVersion(ownerId, ["Duplicate item", "Duplicate item"])).rejects.toThrow(/unique/);
  });

  it("inspection-pass: every item checked passes, goes to Available and stores the checklist it was answered against", async () => {
    const current = await getInspectionChecklist();
    const unit = await waiting();
    const result = await recordApplianceInspection(ownerId, unit, { expectedChecklistVersionId: current.versionId, answers: current.items.map(() => true), notes: " fine ", condition: "Good" });
    expect(result).toMatchObject({ passed: true, overridden: false });
    expect(await statusOf(unit)).toBe("AVAILABLE");
    const saved = await prisma.applianceInspection.findUniqueOrThrow({ where: { id: result.inspectionId } });
    expect(saved).toMatchObject({ passed: true, checklistVersionId: current.versionId, notes: "fine", overrideReason: null, overriddenByUserId: null, inspectedById: ownerId });
    expect(saved.checklistDefinition).toEqual(current.items);
    expect(saved.checklist).toEqual(current.items.map((item) => ({ item, checked: true })));
  });

  it("inspection-fail: an unchecked item fails the inspection and sends the unit to Maintenance, whatever the screen claimed", async () => {
    const current = await getInspectionChecklist();
    const unit = await waiting();
    const answers = current.items.map((_, i) => i !== 0);
    const result = await recordApplianceInspection(ownerId, unit, { expectedChecklistVersionId: current.versionId, answers });
    expect(result).toMatchObject({ passed: false, overridden: false });
    expect(await statusOf(unit)).toBe("MAINTENANCE");
    expect((await prisma.applianceInspection.findUniqueOrThrow({ where: { id: result.inspectionId } })).passed).toBe(false);
  });

  it("inspection-stale-checklist: a form from an older checklist is refused and nothing is saved", async () => {
    const current = await getInspectionChecklist();
    const unit = await waiting();
    await expect(
      recordApplianceInspection(ownerId, unit, { expectedChecklistVersionId: "not-the-current-version", answers: current.items.map(() => true) }),
    ).rejects.toBeInstanceOf(ChecklistVersionError);
    expect(await statusOf(unit)).toBe("AWAITING_INSPECTION");
    expect(await prisma.applianceInspection.count({ where: { applianceId: unit } })).toBe(0);
  });

  it("inspection-answer-count: every item needs an answer", async () => {
    const current = await getInspectionChecklist();
    const unit = await waiting();
    await expect(recordApplianceInspection(ownerId, unit, { expectedChecklistVersionId: current.versionId, answers: [true] })).rejects.toThrow(/Answer every item/);
    expect(await statusOf(unit)).toBe("AWAITING_INSPECTION");
  });

  it("inspection-override: an admin can pass with unchecked items and a reason, which is recorded and audited. Staff cannot", async () => {
    const current = await getInspectionChecklist();
    const answers = current.items.map((_, i) => i !== 1);
    const staffUnit = await waiting();
    const job = await prisma.job.create({ data: { type: "REMOVAL", status: "IN_PROGRESS", assignedToUserId: staffId } });
    await prisma.jobAppliance.create({ data: { jobId: job.id, applianceId: staffUnit } });
    await expect(
      recordApplianceInspection(staffId, staffUnit, { expectedChecklistVersionId: current.versionId, answers, overrideReason: "Looks fine", jobId: job.id }),
    ).rejects.toThrow(/Only an owner or admin/);
    expect(await statusOf(staffUnit)).toBe("AWAITING_INSPECTION");
    await prisma.jobAppliance.deleteMany({ where: { jobId: job.id } });
    await prisma.job.delete({ where: { id: job.id } });

    const unit = await waiting();
    const result = await recordApplianceInspection(adminId, unit, { expectedChecklistVersionId: current.versionId, answers, overrideReason: "  Cosmetic only  " });
    expect(result).toMatchObject({ passed: true, overridden: true });
    expect(await statusOf(unit)).toBe("AVAILABLE");
    expect(await prisma.applianceInspection.findUniqueOrThrow({ where: { id: result.inspectionId } })).toMatchObject({ overrideReason: "Cosmetic only", overriddenByUserId: adminId, passed: true });
    expect(await prisma.auditLog.count({ where: { action: "inspection.override", entityId: result.inspectionId, userId: adminId } })).toBe(1);

    // No reason given: the same unchecked answers are simply a fail.
    const other = await waiting();
    expect(await recordApplianceInspection(adminId, other, { expectedChecklistVersionId: current.versionId, answers })).toMatchObject({ passed: false, overridden: false });
  });

  it("inspection-staff-scope: staff record an inspection only from a job they may work, for an appliance on that job", async () => {
    const current = await getInspectionChecklist();
    const allYes = current.items.map(() => true);
    const unit = await waiting();
    await expect(recordApplianceInspection(staffId, unit, { expectedChecklistVersionId: current.versionId, answers: allYes })).rejects.toThrow(/from the job/);
    const job = await prisma.job.create({ data: { type: "REMOVAL", status: "IN_PROGRESS", assignedToUserId: staffId } });
    await expect(recordApplianceInspection(staffId, unit, { expectedChecklistVersionId: current.versionId, answers: allYes, jobId: job.id })).rejects.toThrow(/not linked/);
    await prisma.jobAppliance.create({ data: { jobId: job.id, applianceId: unit } });
    const ok = await recordApplianceInspection(staffId, unit, { expectedChecklistVersionId: current.versionId, answers: allYes, jobId: job.id });
    expect(ok.passed).toBe(true);
    expect((await prisma.applianceInspection.findUniqueOrThrow({ where: { id: ok.inspectionId } })).jobId).toBe(job.id);
    await prisma.jobAppliance.deleteMany({ where: { jobId: job.id } });
    await prisma.job.delete({ where: { id: job.id } });
  });

  it("inspection-immutable: a recorded inspection cannot be changed or deleted, and a correction is an amendment", async () => {
    const current = await getInspectionChecklist();
    const unit = await waiting();
    const { inspectionId } = await recordApplianceInspection(ownerId, unit, { expectedChecklistVersionId: current.versionId, answers: current.items.map(() => true) });
    await expect(prisma.applianceInspection.update({ where: { id: inspectionId }, data: { passed: false } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(prisma.applianceInspection.delete({ where: { id: inspectionId } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(amendApplianceInspection(staffId, inspectionId, "Wrong box")).rejects.toThrow(/no longer has access/);
    await expect(amendApplianceInspection(ownerId, inspectionId, "   ")).rejects.toThrow(/Write what/);
    const { amendmentId } = await amendApplianceInspection(ownerId, inspectionId, "The hose was replaced the same day");
    expect(await prisma.applianceInspectionAmendment.findUniqueOrThrow({ where: { id: amendmentId } })).toMatchObject({ inspectionId, createdByUserId: ownerId });
    expect((await prisma.applianceInspection.findUniqueOrThrow({ where: { id: inspectionId } })).passed).toBe(true);
  });
});
