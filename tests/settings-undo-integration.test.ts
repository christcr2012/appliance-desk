import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateBusinessSettings } from "@/domains/settings";
import {
  describeSettingsChange, formatSettingValue, listSettingsHistory, undoSettingsChange, SettingsUndoError,
} from "@/domains/settings/history";
import { listSwitches } from "@/domains/settings/switches";

// Batch O-1: settings history with guarded undo, and the read-only switches list.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

describe("settings change wording (pure)", () => {
  it("shows dollars, on/off and lists in plain words and ignores untouched fields", () => {
    const changes = describeSettingsChange(
      { oneTimeDeliveryFeeCents: 4500, depositEnabled: false, serviceAreaCities: ["Greeley"], updatedAt: "a", lateFeeGraceDays: 5 },
      { oneTimeDeliveryFeeCents: 5000, depositEnabled: true, serviceAreaCities: ["Greeley", "Evans"], updatedAt: "b", lateFeeGraceDays: 5 },
    );
    expect(changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).sort()).toEqual([
      "Delivery fee: $45.00 → $50.00",
      "Deposits: Off → On",
      "Service area cities: Greeley → Greeley, Evans",
    ]);
    expect(changes.every((c) => c.undoable)).toBe(true);
  });
  it("marks agreement terms and tax fields as not undoable here", () => {
    const [c] = describeSettingsChange({ earlyTerminationNoticeDays: 30 }, { earlyTerminationNoticeDays: 45 });
    expect(c.undoable).toBe(false);
    expect(formatSettingValue("money", null)).toBe("not set");
  });
});

describe.skipIf(!enabled)("settings undo on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  let ownerId: string;
  let staffId: string;
  let original: { lateFeeGraceDays: number; referralRewardCents: number };

  beforeAll(async () => {
    const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });
    ownerId = owner.id;
    const staff = await prisma.user.create({
      data: { id: `u-${tag}`, name: "Staff", email: `staff-${tag}@example.test`, role: "STAFF", emailVerified: true },
    });
    staffId = staff.id;
    const s = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    original = { lateFeeGraceDays: s.lateFeeGraceDays, referralRewardCents: s.referralRewardCents };
  });
  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: original });
    await prisma.auditLog.deleteMany({ where: { userId: staffId } });
    await prisma.user.delete({ where: { id: staffId } }).catch(() => undefined);
  });

  const lastUpdateRow = () =>
    prisma.auditLog.findFirstOrThrow({ where: { action: "settings.update", userId: ownerId }, orderBy: { createdAt: "desc" } });

  it("undoes one field, writes an Undo row, and leaves other fields alone", async () => {
    await updateBusinessSettings(ownerId, { lateFeeGraceDays: original.lateFeeGraceDays + 2, referralRewardCents: original.referralRewardCents + 100 });
    const row = await lastUpdateRow();
    await undoSettingsChange(ownerId, row.id, "lateFeeGraceDays");
    const s = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(s.lateFeeGraceDays).toBe(original.lateFeeGraceDays);
    expect(s.referralRewardCents).toBe(original.referralRewardCents + 100);
    const undo = await prisma.auditLog.findFirstOrThrow({ where: { action: "settings.undo" }, orderBy: { createdAt: "desc" } });
    expect(undo.userId).toBe(ownerId);
    const history = await listSettingsHistory(10);
    expect(history[0].isUndo).toBe(true);
    // The same change cannot be undone twice: the field no longer holds the value that change gave it.
    await expect(undoSettingsChange(ownerId, row.id, "lateFeeGraceDays")).rejects.toThrow(SettingsUndoError);
  });

  it("refuses when the field changed again, and says so in the history", async () => {
    await updateBusinessSettings(ownerId, { referralRewardCents: original.referralRewardCents + 200 });
    const first = await lastUpdateRow();
    await updateBusinessSettings(ownerId, { referralRewardCents: original.referralRewardCents + 300 });
    await expect(undoSettingsChange(ownerId, first.id, "referralRewardCents")).rejects.toThrow(/changed again/);
    const history = await listSettingsHistory(10);
    const older = history.find((h) => h.id === first.id)!;
    expect(older.undo.find((u) => u.key === "referralRewardCents")?.ok).toBe(false);
    const newest = history.find((h) => !h.isUndo)!;
    expect(newest.undo.find((u) => u.key === "referralRewardCents")?.ok).toBe(true);
  });

  it("refuses a stale Undo when a newer change put the same value back (B to C to B)", async () => {
    const base = original.referralRewardCents;
    await updateBusinessSettings(ownerId, { referralRewardCents: base + 500 });
    const first = await lastUpdateRow(); // base -> base+500
    await updateBusinessSettings(ownerId, { referralRewardCents: base + 600 });
    await updateBusinessSettings(ownerId, { referralRewardCents: base + 500 });
    await expect(undoSettingsChange(ownerId, first.id, "referralRewardCents")).rejects.toThrow(/changed again/);
    const history = await listSettingsHistory(10);
    expect(history.find((h) => h.id === first.id)!.undo.find((u) => u.key === "referralRewardCents")?.ok).toBe(false);
    const s = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(s.referralRewardCents).toBe(base + 500);
  });

  it("refuses staff and fields outside the undoable list", async () => {
    await updateBusinessSettings(ownerId, { lateFeeGraceDays: original.lateFeeGraceDays + 1 });
    const row = await lastUpdateRow();
    await expect(undoSettingsChange(staffId, row.id, "lateFeeGraceDays")).rejects.toThrow();
    await expect(undoSettingsChange(ownerId, row.id, "customerEmailEnabled")).rejects.toThrow(/cannot be undone/);
    const s = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(s.lateFeeGraceDays).toBe(original.lateFeeGraceDays + 1);
  });

  it("lists the switches without exposing secrets", async () => {
    const rows = await listSwitches();
    expect(rows.find((r) => r.id === "sms")?.state).toMatch(/^Switched (on|off) \(/);
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(["customer-email", "sms", "auto-renew", "payments", "two-factor", "books-start"]));
    expect(JSON.stringify(rows)).not.toMatch(/sk_(live|test)_/);
  });
});
