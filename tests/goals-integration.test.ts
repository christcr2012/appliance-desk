import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { setAdminCapability } from "@/domains/capabilities";
import {
  clearMonthlyGoal, getAlertSettings, getGoalProgress, listIdleAppliances, setAlertSettings, setMonthlyGoal,
} from "@/domains/goals";
import { listGoalAttention } from "@/domains/exceptions/goal-attention";

// Batch O-5 on real Postgres. A far-future month is used so real rentals and receipts never count.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("goals and alerts on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  const adminId = `goal-admin-${tag}`;
  const typeId = `goal-type-${tag}`;
  const applianceIds: string[] = [];
  const day20 = new Date("2031-03-20T18:00:00Z");
  let ownerId: string;
  let saved: { idleApplianceAlertDays: number; utilizationAlertPercent: number | null };

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.user.create({ data: { id: adminId, name: "Goal Admin", email: `${tag}-goal@example.test`, role: "ADMIN", emailVerified: true } });
    saved = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { idleApplianceAlertDays: true, utilizationAlertPercent: true } });
    await prisma.applianceType.create({ data: { id: typeId, name: `Goal Type ${tag}`, slug: `goal-type-${tag}` } });
  });
  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: saved });
    await prisma.businessGoal.deleteMany({ where: { month: { gte: new Date("2031-01-01") } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: adminId } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: adminId }, { entityId: { startsWith: "newRentals:2031" } }, { entityId: { startsWith: "cash:2031" } }] } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  });

  it("sets, changes and clears a monthly target, with an audit trail", async () => {
    await setMonthlyGoal(ownerId, "newRentals", 40, day20);
    await setMonthlyGoal(ownerId, "newRentals", 50, day20);
    expect(await prisma.businessGoal.count({ where: { metricKey: "newRentals", month: { gte: new Date("2031-03-01"), lt: new Date("2031-04-02") } } })).toBe(1);
    const progress = await getGoalProgress(day20);
    const rentals = progress.find((p) => p.metric === "newRentals")!;
    expect(rentals.target).toBe(50);
    expect(rentals.actual).toBe(0);
    expect(rentals.pace?.status).toBe("BEHIND");
    expect(progress.find((p) => p.metric === "cash")!.target).toBeNull();
    const audits = await prisma.auditLog.findMany({ where: { action: "goal.set", entityId: { startsWith: "newRentals:2031" } }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => (a.newValue as { target: number }).target)).toEqual([40, 50]);
    await clearMonthlyGoal(ownerId, "newRentals", day20);
    expect((await getGoalProgress(day20)).find((p) => p.metric === "newRentals")!.target).toBeNull();
  });

  it("rejects bad input and unknown metrics", async () => {
    await expect(setMonthlyGoal(ownerId, "newRentals", 0, day20)).rejects.toThrow();
    await expect(setMonthlyGoal(ownerId, "bogus", 5, day20)).rejects.toThrow();
    await expect(setAlertSettings(ownerId, { idleDays: 400, utilizationPercent: null })).rejects.toThrow();
    await expect(setAlertSettings(ownerId, { idleDays: 10, utilizationPercent: 100 })).rejects.toThrow();
  });

  it("an admin follows the settings permission; customers and strangers cannot", async () => {
    await setMonthlyGoal(adminId, "newRentals", 9, day20);
    await clearMonthlyGoal(adminId, "newRentals", day20);
    await setAdminCapability(ownerId, adminId, "EDIT_SETTINGS", false);
    await expect(setMonthlyGoal(adminId, "newRentals", 9, day20)).rejects.toThrow();
    await expect(setAlertSettings(adminId, { idleDays: 5, utilizationPercent: null })).rejects.toThrow();
    await expect(setMonthlyGoal(`nobody-${tag}`, "newRentals", 9, day20)).rejects.toThrow();
  });

  it("alert settings save with an audit row and restore the recommended values", async () => {
    await setAlertSettings(ownerId, { idleDays: 14, utilizationPercent: 40 });
    expect(await getAlertSettings()).toEqual({ idleDays: 14, utilizationPercent: 40 });
    await setAlertSettings(ownerId, { idleDays: 30, utilizationPercent: null });
    expect(await getAlertSettings()).toEqual({ idleDays: 30, utilizationPercent: null });
    expect(await prisma.auditLog.count({ where: { userId: ownerId, action: "settings.alerts" } })).toBeGreaterThanOrEqual(2);
  });

  it("finds ready-to-rent appliances that sat idle, ignores recent, rented and idle-off", async () => {
    const old = new Date(Date.now() - 90 * 86_400_000);
    const rows = [
      { id: `goal-old-${tag}`, assetNumber: `GOAL-OLD-${tag}`, status: "AVAILABLE" as const, createdAt: old },
      { id: `goal-new-${tag}`, assetNumber: `GOAL-NEW-${tag}`, status: "AVAILABLE" as const, createdAt: new Date() },
      { id: `goal-rented-${tag}`, assetNumber: `GOAL-RENTED-${tag}`, status: "RENTED" as const, createdAt: old },
    ];
    for (const r of rows) {
      await prisma.appliance.create({ data: { ...r, applianceTypeId: typeId } });
      applianceIds.push(r.id);
    }
    const idle = await listIdleAppliances(30);
    const mine = idle.sample.filter((a) => a.assetNumber.endsWith(tag));
    expect(mine.map((a) => a.assetNumber)).toEqual([`GOAL-OLD-${tag}`]);
    expect(idle.total).toBeGreaterThanOrEqual(1);
    expect(await listIdleAppliances(0)).toEqual({ total: 0, sample: [] });
  });

  it("Today shows one behind-pace goal item, and idle appliances as one aggregated item", async () => {
    await setAdminCapability(ownerId, adminId, "EDIT_SETTINGS", true);
    await setMonthlyGoal(ownerId, "newRentals", 60, day20);
    const items = await listGoalAttention(day20);
    const goal = items.filter((i) => i.category === "GOAL_BEHIND");
    expect(goal).toHaveLength(1);
    expect(goal[0].href).toBe("/desk/settings/goals");
    expect(items.filter((i) => i.category === "IDLE_APPLIANCES").length).toBeLessThanOrEqual(1);
    // First week of the month: quiet.
    const early = await listGoalAttention(new Date("2031-03-03T18:00:00Z"));
    expect(early.filter((i) => i.category === "GOAL_BEHIND")).toHaveLength(0);
  });
});
