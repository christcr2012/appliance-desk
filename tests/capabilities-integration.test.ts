import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { assertCapability, CapabilityError, listAdminCapabilities, setAdminCapability } from "@/domains/capabilities";
import { updateBusinessSettings } from "@/domains/settings";
import { writeOffInvoice } from "@/domains/billing/manual-payments";
import { setAppliancePhotoUrl, updateAppliancePrice } from "@/domains/settings";
import { createPackage, setPackageActive, setPackageVisibility, updatePackage } from "@/domains/packages";
import { setMonthToMonthSettings } from "@/domains/settings/month-to-month-save";
import { saveLeadScoringPolicy } from "@/domains/leads/scoring-policy";
import { setRetiredFollowUpDays } from "@/domains/inventory/retired-plans";

// Batch O-2A on real Postgres: a limit takes effect on the very next action, restoring puts it back, and nobody gains access.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("admin permission limits on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  let ownerId: string;
  let adminId: string;
  let staffId: string;
  const can = (id: string, cap: Parameters<typeof assertCapability>[2]) => prisma.$transaction((tx) => assertCapability(tx, id, cap));

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    adminId = `cap-admin-${tag}`;
    staffId = `cap-staff-${tag}`;
    await prisma.user.create({ data: { id: adminId, name: "Cap Admin", email: `${tag}-a@example.test`, role: "ADMIN", emailVerified: true } });
    await prisma.user.create({ data: { id: staffId, name: "Cap Staff", email: `${tag}-s@example.test`, role: "STAFF", emailVerified: true } });
  });
  afterAll(async () => {
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: adminId } });
    await prisma.auditLog.deleteMany({ where: { entityId: adminId } });
  });

  it("with no limits, owner and admin pass and staff are refused (exactly today's rules)", async () => {
    await expect(can(ownerId, "WRITE_OFF")).resolves.toBeTruthy();
    await expect(can(adminId, "WRITE_OFF")).resolves.toBeTruthy();
    await expect(can(staffId, "WRITE_OFF")).rejects.toThrow(/no longer has access/);
  });

  it("limiting an admin takes effect on the next action, only for that permission, and restoring puts it back", async () => {
    expect((await setAdminCapability(ownerId, adminId, "WRITE_OFF", false)).changed).toBe(true);
    await expect(can(adminId, "WRITE_OFF")).rejects.toThrow(CapabilityError);
    await expect(can(adminId, "RECORD_MANUAL_PAYMENT")).resolves.toBeTruthy();
    // a real money function refuses before touching anything
    await expect(writeOffInvoice("no-such-invoice", adminId, "test")).rejects.toThrow(/permission/);
    expect((await listAdminCapabilities()).find((a) => a.userId === adminId)?.limited).toEqual(["WRITE_OFF"]);
    expect((await setAdminCapability(ownerId, adminId, "WRITE_OFF", false)).changed).toBe(false);
    expect((await setAdminCapability(ownerId, adminId, "WRITE_OFF", true)).changed).toBe(true);
    await expect(can(adminId, "WRITE_OFF")).resolves.toBeTruthy();
    const audit = await prisma.auditLog.findMany({ where: { action: "staff.capability", entityId: adminId }, orderBy: { createdAt: "asc" } });
    expect(audit).toHaveLength(2);
  });

  it("settings saves honour the EDIT_SETTINGS limit and the owner is never limited", async () => {
    await setAdminCapability(ownerId, adminId, "EDIT_SETTINGS", false);
    await expect(updateBusinessSettings(adminId, { lateFeeGraceDays: 5 })).rejects.toThrow(/permission/);
    await expect(updateBusinessSettings(ownerId, {})).resolves.toBeTruthy();
    await setAdminCapability(ownerId, adminId, "EDIT_SETTINGS", true);
  });

  it("an admin limited from changing settings cannot change prices, sets, notice rules or policies by another route either", async () => {
    const typeId = `cap-type-${tag}`;
    await prisma.applianceType.create({ data: { id: typeId, name: `Cap Type ${tag}`, slug: `cap-type-${tag}`, monthlyPriceCents: 4000 } });
    const set = { name: `Cap Set ${tag}`, monthlyPriceCents: 1000, components: [{ applianceTypeId: typeId, quantity: 1 }] };
    try {
      await setAdminCapability(ownerId, adminId, "EDIT_SETTINGS", false);
      const refused = [
        () => updateAppliancePrice(adminId, typeId, 5000),
        () => setAppliancePhotoUrl(adminId, typeId, null),
        () => createPackage(adminId, set),
        () => updatePackage(adminId, "no-such-set", set),
        () => setPackageVisibility(adminId, "no-such-set", true),
        () => setPackageActive(adminId, "no-such-set", false),
        () => setMonthToMonthSettings(adminId, { days: 30, termsChangeNoticeText: null, annualReminderText: null }),
        () => saveLeadScoringPolicy(adminId, { termPoints: { "month-to-month": 1, "6-month": 12, "12-month": 24 }, additionalUnitPoints: 6, businessAccountPoints: 11, multiUnitPropertyManagerPoints: 26, highValueThreshold: 35 }),
        () => setRetiredFollowUpDays(adminId, 30),
      ];
      for (const call of refused) await expect(call()).rejects.toThrow(/permission/);
      expect((await prisma.applianceType.findUniqueOrThrow({ where: { id: typeId } })).monthlyPriceCents).toBe(4000);
      expect(await prisma.rentalPackage.count({ where: { name: set.name } })).toBe(0);
      // Restored, the same admin can again (exactly today's rule), and the owner never needed the permission.
      await setAdminCapability(ownerId, adminId, "EDIT_SETTINGS", true);
      await updateAppliancePrice(adminId, typeId, 5000);
      await updateAppliancePrice(ownerId, typeId, 4500);
      expect((await prisma.applianceType.findUniqueOrThrow({ where: { id: typeId } })).monthlyPriceCents).toBe(4500);
    } finally {
      await setAdminCapability(ownerId, adminId, "EDIT_SETTINGS", true).catch(() => null);
      await prisma.pricingRule.deleteMany({ where: { applianceTypeId: typeId } });
      await prisma.auditLog.deleteMany({ where: { entityId: typeId } });
      await prisma.applianceType.deleteMany({ where: { id: typeId } });
    }
  });

  it("only the owner can change limits, only on active admins, never on staff or the owner", async () => {
    await expect(setAdminCapability(adminId, adminId, "WRITE_OFF", false)).rejects.toThrow(/Only the owner/);
    await expect(setAdminCapability(ownerId, staffId, "WRITE_OFF", false)).rejects.toThrow(/active admin/);
    await expect(setAdminCapability(ownerId, ownerId, "WRITE_OFF", false)).rejects.toThrow(/active admin/);
    await expect(setAdminCapability(ownerId, adminId, "NOT_A_THING", false)).rejects.toThrow(/does not exist/);
  });
});
