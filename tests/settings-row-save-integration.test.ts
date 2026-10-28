// AR-8 (SETTINGS spec sections 5 + 8): the generic row save on real
// Postgres — dollars become cents with an audit row, a stale revision is a
// conflict, an owner-only row refuses an admin, the delivery-window rule
// runs inside the save, restore-recommended works, the toast undo works,
// STAFF never gets in, and a domain-writer row uses its writer.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "", role: "OWNER" as string }));
vi.mock("@/lib/session", () => ({
  requireRole: async (...roles: string[]) => {
    if (!roles.includes(session.role)) throw new Error("Not allowed");
    return { user: { id: session.userId, role: session.role } };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { fieldsRevision } from "@/domains/settings/preview";
import { saveSettingRowAction, undoSettingRowAction } from "@/app/desk/settings/row-actions";

const target = (() => { try { return new URL(process.env.DATABASE_URL ?? ""); } catch { return null; } })();
const enabled = process.env.CI === "true" && !!target && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

const row = () => prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
const revFor = async (key: string) => fieldsRevision(await row(), [key]);

describe.skipIf(!enabled)("AR-8 row save on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  let ownerId = "";
  let adminId = "";
  let snapshot: Record<string, unknown> = {};

  beforeAll(async () => {
    const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    ownerId = owner.id;
    adminId = admin.id;
    session.userId = ownerId;
    session.role = "OWNER";
    const s = await row();
    snapshot = {
      relocationFeeCents: s.relocationFeeCents,
      oneTimeDeliveryFeeCents: s.oneTimeDeliveryFeeCents,
      deliveryMorningStartHour: s.deliveryMorningStartHour,
      deliveryMorningEndHour: s.deliveryMorningEndHour,
      retiredFollowUpDays: s.retiredFollowUpDays,
    };
  });

  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: snapshot as never });
  });

  it("saves a money row as cents and writes the audit row", async () => {
    const before = await prisma.auditLog.count({ where: { action: "settings.update", userId: ownerId } });
    const result = await saveSettingRowAction("relocationFeeCents", 80, await revFor("relocationFeeCents"));
    expect(result.status).toBe("success");
    expect((await row()).relocationFeeCents).toBe(8000);
    expect(await prisma.auditLog.count({ where: { action: "settings.update", userId: ownerId } })).toBe(before + 1);
  });

  it("refuses a stale revision as a conflict and writes nothing", async () => {
    const stale = await revFor("relocationFeeCents");
    await saveSettingRowAction("relocationFeeCents", 85, stale);
    const result = await saveSettingRowAction("relocationFeeCents", 90, stale);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.message).toMatch(/changed|reload/i);
    expect((await row()).relocationFeeCents).toBe(8500);
  });

  it("refuses an owner-only row for an admin", async () => {
    session.userId = adminId;
    session.role = "ADMIN";
    try {
      const result = await saveSettingRowAction("tenantContactRetentionMonths", 6, await revFor("tenantContactRetentionMonths"));
      expect(result).toEqual({ status: "error", message: "Only the owner can change this." });
    } finally {
      session.userId = ownerId;
      session.role = "OWNER";
    }
  });

  it("refuses STAFF before anything is read or written", async () => {
    session.role = "STAFF";
    try {
      await expect(saveSettingRowAction("relocationFeeCents", 1, "x")).rejects.toThrow("Not allowed");
    } finally {
      session.role = "OWNER";
    }
  });

  it("refuses a delivery window that would start after it ends — in both orders", async () => {
    // Start moves later first (8→11 against a 12 end: fine), then the end tries to move before it.
    expect((await saveSettingRowAction("deliveryMorningStartHour", 11, await revFor("deliveryMorningStartHour"))).status).toBe("success");
    const refused = await saveSettingRowAction("deliveryMorningEndHour", 10, await revFor("deliveryMorningEndHour"));
    expect(refused.status).toBe("error");
    if (refused.status === "error") expect(refused.message).toBe("The window must start before it ends.");
    expect((await row()).deliveryMorningEndHour).toBe(12);
    // Back to the snapshot window, then the other order: end first (12→9 against an 8 start: fine),
    // then the start tries to move past it.
    await saveSettingRowAction("deliveryMorningStartHour", 8, await revFor("deliveryMorningStartHour"));
    expect((await saveSettingRowAction("deliveryMorningEndHour", 9, await revFor("deliveryMorningEndHour"))).status).toBe("success");
    const refused2 = await saveSettingRowAction("deliveryMorningStartHour", 10, await revFor("deliveryMorningStartHour"));
    expect(refused2.status).toBe("error");
    await saveSettingRowAction("deliveryMorningEndHour", 12, await revFor("deliveryMorningEndHour"));
  });

  it("restores the recommended value through the same save", async () => {
    await saveSettingRowAction("relocationFeeCents", 90, await revFor("relocationFeeCents"));
    expect((await row()).relocationFeeCents).toBe(9000);
    const result = await saveSettingRowAction("relocationFeeCents", 75, await revFor("relocationFeeCents"));
    expect(result.status).toBe("success");
    expect((await row()).relocationFeeCents).toBe(7500);
  });

  it("undoes a row save from its audit id (the toast Undo)", async () => {
    const before = (await row()).oneTimeDeliveryFeeCents;
    const saved = await saveSettingRowAction("oneTimeDeliveryFeeCents", 25, await revFor("oneTimeDeliveryFeeCents"));
    expect(saved.status).toBe("success");
    if (saved.status !== "success" || !saved.auditId) throw new Error("save did not return an audit id");
    expect((await row()).oneTimeDeliveryFeeCents).toBe(2500);
    const undone = await undoSettingRowAction(saved.auditId, "oneTimeDeliveryFeeCents");
    expect(undone.status).toBe("success");
    expect((await row()).oneTimeDeliveryFeeCents).toBe(before);
  });

  it("saves a domain-writer row through its writer, with the writer's own audit action", async () => {
    const result = await saveSettingRowAction("retiredFollowUpDays", 45, await revFor("retiredFollowUpDays"));
    expect(result.status).toBe("success");
    expect((await row()).retiredFollowUpDays).toBe(45);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "settings.retired_follow_up_days", userId: ownerId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    void tag;
  });

  it("refuses a domain-writer row save made from a stale page (AR-8 review P2)", async () => {
    const before = (await row()).trustedDeviceDays;
    const fresh = await revFor("trustedDeviceDays");
    const ok = await saveSettingRowAction("trustedDeviceDays", 15, fresh);
    expect(ok.status).toBe("success");
    expect((await row()).trustedDeviceDays).toBe(15);
    // The same revision again is now stale: the value moved after the page was drawn.
    const stale = await saveSettingRowAction("trustedDeviceDays", 20, fresh);
    expect(stale.status).toBe("error");
    if (stale.status === "error") expect(stale.message).toMatch(/Someone else changed/);
    expect((await row()).trustedDeviceDays).toBe(15);
    const restored = await saveSettingRowAction("trustedDeviceDays", before, await revFor("trustedDeviceDays"));
    expect(restored.status).toBe("success");
  });
});
