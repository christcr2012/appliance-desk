import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));

import {
  addAppliancePhoto,
  createApplianceUnits,
  updateApplianceDetails,
} from "@/domains/inventory";
import { retireAppliance, startRepairForAppliance } from "@/domains/inventory/guided-actions";
import { prisma } from "@/lib/prisma";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

/**
 * R13: every owner/admin inventory command is one transaction that re-checks the actor,
 * changes the record and writes its audit entry together.
 */
describe.skipIf(!enabled)("R13 inventory commands are guarded transactions", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `r13-owner-${tag}`;
  const staffId = `r13-staff-${tag}`;
  const archivedId = `r13-archived-${tag}`;
  const typeId = `r13-type-${tag}`;
  const applianceIds: string[] = [];
  const triggers: string[] = [];

  async function unit(status: "AVAILABLE" | "RETIRED" = "AVAILABLE") {
    const id = `r13-unit-${applianceIds.length}-${tag}`;
    applianceIds.push(id);
    await prisma.appliance.create({
      data: { id, assetNumber: `R13${applianceIds.length}-${tag.slice(0, 8)}`, applianceTypeId: typeId, status },
    });
    return id;
  }
  const load = (id: string) => prisma.appliance.findUniqueOrThrow({ where: { id } });
  const audits = (id: string) => prisma.auditLog.count({ where: { entityId: id } });

  /** Make any audit write for this appliance fail, as a real database fault would. */
  async function breakAuditFor(id: string) {
    const fn = `r13_fail_${id.replace(/\W/g, "_")}`;
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${fn}"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated audit failure'; END $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "${fn}" BEFORE INSERT ON "AuditLog" FOR EACH ROW WHEN (NEW."entityId" = '${id}') EXECUTE FUNCTION "${fn}"()`,
    );
    triggers.push(fn);
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `o-${tag}@example.test`, name: "R13 owner", role: "OWNER", emailVerified: true },
        { id: staffId, email: `s-${tag}@example.test`, name: "R13 staff", role: "STAFF", emailVerified: true },
        { id: archivedId, email: `a-${tag}@example.test`, name: "R13 gone", role: "ADMIN", emailVerified: true, archivedAt: new Date() },
      ],
    });
    await prisma.applianceType.create({ data: { id: typeId, name: `R13 ${tag}`, slug: `r13-${tag}` } });
  });

  afterEach(async () => {
    for (const fn of triggers.splice(0)) {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fn}" ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
  });

  afterAll(async () => {
    const created = await prisma.appliance.findMany({ where: { applianceTypeId: typeId }, select: { id: true } });
    const ids = created.map((a) => a.id);
    const jobs = await prisma.jobAppliance.findMany({ where: { applianceId: { in: ids } }, select: { jobId: true } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: ids } }, { userId: { in: [ownerId, staffId, archivedId] } }] },
    });
    await prisma.photo.deleteMany({ where: { applianceId: { in: ids } } });
    await prisma.jobAppliance.deleteMany({ where: { applianceId: { in: ids } } });
    await prisma.job.deleteMany({ where: { id: { in: jobs.map((j) => j.jobId) } } });
    await prisma.appliance.deleteMany({ where: { id: { in: ids } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, archivedId] } } });
  });

  describe.each([
    ["staff member", () => staffId],
    ["archived admin", () => archivedId],
  ])("a %s is refused by every command, with nothing written", (_label, actor) => {
    it("createApplianceUnits", async () => {
      const before = await prisma.appliance.count({ where: { applianceTypeId: typeId } });
      await expect(createApplianceUnits(actor(), { applianceTypeId: typeId, quantity: 2 })).rejects.toThrow(/no longer has access/);
      expect(await prisma.appliance.count({ where: { applianceTypeId: typeId } })).toBe(before);
    });
    it("updateApplianceDetails", async () => {
      const id = await unit();
      const row = await load(id);
      await expect(updateApplianceDetails(actor(), id, { notes: "changed" }, row.updatedAt)).rejects.toThrow(/no longer has access/);
      expect((await load(id)).notes).toBeNull();
    });
    it("addAppliancePhoto", async () => {
      const id = await unit();
      await expect(addAppliancePhoto(actor(), id, { url: "https://example.test/p.jpg" })).rejects.toThrow(/no longer has access/);
      expect(await prisma.photo.count({ where: { applianceId: id } })).toBe(0);
    });
    it("startRepairForAppliance", async () => {
      const id = await unit();
      await expect(startRepairForAppliance(actor(), id)).rejects.toThrow(/no longer has access/);
      expect((await load(id)).status).toBe("AVAILABLE");
      expect(await prisma.jobAppliance.count({ where: { applianceId: id } })).toBe(0);
    });
    it("retireAppliance", async () => {
      const id = await unit();
      await expect(retireAppliance(actor(), id, "worn out")).rejects.toThrow(/no longer has access/);
      expect((await load(id)).status).toBe("AVAILABLE");
    });
  });

  describe("the change and its audit entry commit or roll back together", () => {
    it("createApplianceUnits: audit failure leaves no units", async () => {
      // The audit rows are keyed by the new unit ids, which are not known in advance, so
      // break the audit for every row of this fixture's owner instead.
      const fn = `r13_fail_create_${tag}`;
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION "${fn}"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated audit failure'; END $$ LANGUAGE plpgsql`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "${fn}" BEFORE INSERT ON "AuditLog" FOR EACH ROW WHEN (NEW."userId" = '${ownerId}' AND NEW."action" = 'appliance.unit.create') EXECUTE FUNCTION "${fn}"()`,
      );
      triggers.push(fn);
      const before = await prisma.appliance.count({ where: { applianceTypeId: typeId } });
      await expect(createApplianceUnits(ownerId, { applianceTypeId: typeId, quantity: 2 })).rejects.toThrow();
      expect(await prisma.appliance.count({ where: { applianceTypeId: typeId } })).toBe(before);
    });

    it("updateApplianceDetails: audit failure keeps the old details", async () => {
      const id = await unit();
      const row = await load(id);
      await breakAuditFor(id);
      await expect(updateApplianceDetails(ownerId, id, { notes: "changed" }, row.updatedAt)).rejects.toThrow();
      expect((await load(id)).notes).toBeNull();
    });

    it("addAppliancePhoto: audit failure leaves no photo", async () => {
      const id = await unit();
      await breakAuditFor(id);
      await expect(addAppliancePhoto(ownerId, id, { url: "https://example.test/p.jpg" })).rejects.toThrow();
      expect(await prisma.photo.count({ where: { applianceId: id } })).toBe(0);
    });

    it("startRepairForAppliance: audit failure leaves no job and no status change", async () => {
      const id = await unit();
      await breakAuditFor(id);
      await expect(startRepairForAppliance(ownerId, id)).rejects.toThrow();
      expect((await load(id)).status).toBe("AVAILABLE");
      expect(await prisma.jobAppliance.count({ where: { applianceId: id } })).toBe(0);
    });

    it("retireAppliance: audit failure leaves the unit unretired", async () => {
      const id = await unit();
      await breakAuditFor(id);
      await expect(retireAppliance(ownerId, id, "worn out")).rejects.toThrow();
      const after = await load(id);
      expect(after.status).toBe("AVAILABLE");
      expect(after.notes).toBeNull();
    });
  });

  describe("owner commands still work", () => {
    it("adds units, edits, photographs, starts a repair on one, retires another", async () => {
      const [first] = await createApplianceUnits(ownerId, { applianceTypeId: typeId, quantity: 1 });
      const row = await load(first!.id);
      await updateApplianceDetails(ownerId, row.id, { notes: "ok" }, row.updatedAt);
      await addAppliancePhoto(ownerId, row.id, { url: "https://example.test/p.jpg" });
      const { jobId } = await startRepairForAppliance(ownerId, row.id, "noisy");
      expect((await load(row.id)).status).toBe("MAINTENANCE");
      expect(jobId).toBeTruthy();
      expect(await audits(row.id)).toBeGreaterThanOrEqual(4);

      const other = await unit();
      await retireAppliance(ownerId, other, "worn out");
      expect((await load(other)).status).toBe("RETIRED");
    });

    it("two overlapping retire commands: one wins, one is told", async () => {
      const id = await unit();
      const results = await Promise.allSettled([
        retireAppliance(ownerId, id, "first"),
        retireAppliance(ownerId, id, "second"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await load(id)).notes?.match(/Retired:/g)).toHaveLength(1);
    });
  });
});
