import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { assertCapability, CapabilityError, listAdminCapabilities, setAdminCapability } from "@/domains/capabilities";
import { updateBusinessSettings } from "@/domains/settings";
import { writeOffInvoice } from "@/domains/billing/manual-payments";

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

  it("only the owner can change limits, only on active admins, never on staff or the owner", async () => {
    await expect(setAdminCapability(adminId, adminId, "WRITE_OFF", false)).rejects.toThrow(/Only the owner/);
    await expect(setAdminCapability(ownerId, staffId, "WRITE_OFF", false)).rejects.toThrow(/active admin/);
    await expect(setAdminCapability(ownerId, ownerId, "WRITE_OFF", false)).rejects.toThrow(/active admin/);
    await expect(setAdminCapability(ownerId, adminId, "NOT_A_THING", false)).rejects.toThrow(/does not exist/);
  });
});
