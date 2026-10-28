import { randomUUID } from "node:crypto";
import { vi } from "vitest";
// AR-8: listSettingsHistory now guards itself with requireRole (SETTINGS spec section 1), so this
// suite stands in an owner session the way the history page does.
vi.mock("@/lib/session", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/session")>()),
  requireRole: async () => ({ user: { id: "history-test-owner", role: "OWNER" } }),
}));
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateBusinessSettings } from "@/domains/settings";
import {
  describeSettingsChange, formatSettingValue, listSettingsHistory, undoSettingsChange, SettingsUndoError,
} from "@/domains/settings/history";
import { listSwitches } from "@/domains/settings/switches";
import { previewSettingsUndo } from "@/domains/settings/history";
import { SettingsConflictError } from "@/domains/settings/effects";
import { sectionRevision } from "@/domains/settings/preview";
import { setAutomationPaused, AUTOMATION_RULES } from "@/domains/automation/health";

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
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(["customer-email", "sms", "auto-renew", "payments", "two-factor", "approval-limits", "books-start"]));
    expect(JSON.stringify(rows)).not.toMatch(/sk_(live|test)_/);
  });

  it("previews an undo without writing anything, and the preview shows now and after", async () => {
    const prior = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).lateFeeGraceDays;
    await updateBusinessSettings(ownerId, { lateFeeGraceDays: prior + 4 });
    const row = await lastUpdateRow();
    const auditBefore = await prisma.auditLog.count();
    const settingsBefore = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    const preview = await previewSettingsUndo(row.id, "lateFeeGraceDays");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.current).toBe(String(prior + 4));
    expect(preview.restored).toBe(String(prior));
    expect(preview.effect).toMatch(/already billed do not change/);
    expect(await prisma.auditLog.count()).toBe(auditBefore);
    const settingsAfter = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(settingsAfter.updatedAt).toEqual(settingsBefore.updatedAt);
    // Confirming with what the preview showed works.
    await undoSettingsChange(ownerId, row.id, "lateFeeGraceDays", preview.expectedCurrent);
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).lateFeeGraceDays).toBe(prior);
  });

  it("explains why a refused undo cannot be previewed", async () => {
    const preview = await previewSettingsUndo("no-such-row", "lateFeeGraceDays");
    expect(preview).toEqual({ ok: false, reason: "That change is no longer in the history." });
    expect(await previewSettingsUndo("x", "customerEmailEnabled")).toEqual({ ok: false, reason: "That setting cannot be undone from here." });
  });

  it("refuses an undo as a conflict when the setting changed after the preview was shown", async () => {
    await updateBusinessSettings(ownerId, { referralRewardCents: original.referralRewardCents + 700 });
    const row = await lastUpdateRow();
    const stalePreview = JSON.stringify(original.referralRewardCents + 123); // what some older screen believed it held
    await expect(undoSettingsChange(ownerId, row.id, "referralRewardCents", stalePreview)).rejects.toThrow(SettingsConflictError);
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).referralRewardCents).toBe(original.referralRewardCents + 700);
    expect(await prisma.auditLog.count({ where: { action: "settings.undo", createdAt: { gt: row.createdAt } } })).toBe(0);
  });

  it("reports a conflict, not a generic refusal, when the setting moves between the preview and the confirm", async () => {
    await updateBusinessSettings(ownerId, { referralRewardCents: original.referralRewardCents + 1100 });
    const row = await lastUpdateRow();
    const preview = await previewSettingsUndo(row.id, "referralRewardCents");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    await updateBusinessSettings(ownerId, { referralRewardCents: original.referralRewardCents + 1200 });
    await expect(undoSettingsChange(ownerId, row.id, "referralRewardCents", preview.expectedCurrent)).rejects.toThrow(SettingsConflictError);
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).referralRewardCents).toBe(original.referralRewardCents + 1200);
  });

  it("refuses a section save made from an out-of-date page, writes nothing, and allows it after a reload", async () => {
    const opened = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    const revision = sectionRevision(opened, "policies");
    // Somebody else saves the same section after the page was opened.
    await updateBusinessSettings(ownerId, { lateFeeGraceDays: opened.lateFeeGraceDays + 3 });
    const auditCount = await prisma.auditLog.count({ where: { action: "settings.update" } });
    await expect(
      updateBusinessSettings(ownerId, { referralRewardCents: opened.referralRewardCents + 900 }, { expectedRevision: { section: "policies", value: revision } }),
    ).rejects.toThrow(SettingsConflictError);
    const unchanged = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(unchanged.referralRewardCents).toBe(opened.referralRewardCents);
    expect(unchanged.lateFeeGraceDays).toBe(opened.lateFeeGraceDays + 3);
    expect(await prisma.auditLog.count({ where: { action: "settings.update" } })).toBe(auditCount);
    // After reloading, the new fingerprint is accepted.
    await updateBusinessSettings(ownerId, { referralRewardCents: opened.referralRewardCents + 900 }, { expectedRevision: { section: "policies", value: sectionRevision(unchanged, "policies") } });
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).referralRewardCents).toBe(opened.referralRewardCents + 900);
  });

  it("does not report a conflict for a change in a different section or unrelated bookkeeping", async () => {
    const opened = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    const revision = sectionRevision(opened, "policies");
    await updateBusinessSettings(ownerId, { publicPhone: `970${tag.replace(/\D/g, "").padEnd(7, "1").slice(0, 7)}` });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { pausedAutomations: [] } });
    await expect(
      updateBusinessSettings(ownerId, { lateFeeGraceDays: opened.lateFeeGraceDays }, { expectedRevision: { section: "policies", value: revision } }),
    ).resolves.toBeDefined();
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { publicPhone: opened.publicPhone } });
  });

  it("shows launch emails and the Colorado tax lookup, and who last changed paused automations", async () => {
    const rule = AUTOMATION_RULES[0].ruleKey;
    await setAutomationPaused(ownerId, rule, true);
    const rows = await listSwitches();
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["launch-emails", "tax-lookup", "paused-automations"]));
    expect(rows.find((r) => r.id === "tax-lookup")?.state).toMatch(/^(Connected|Not connected)/);
    expect(rows.find((r) => r.id === "launch-emails")?.state).toMatch(/^(On|Off)/);
    const paused = rows.find((r) => r.id === "paused-automations")!;
    expect(paused.on).toBe(true);
    expect(paused.lastChange).not.toBeNull();
    await setAutomationPaused(ownerId, rule, false);
    expect((await listSwitches()).find((r) => r.id === "paused-automations")?.on).toBe(false);
    // Every "where to change it" link points at a real screen, not a guess.
    for (const r of rows) expect(r.changeAt).toMatch(/^\/desk\//);
  });
});
