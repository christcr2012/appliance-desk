import { describe, expect, it } from "vitest";
import {
  SECTION_STORED_KEYS, fieldsRevision, previewSettingsUpdate, sectionRevision, settingEffect,
} from "@/domains/settings/preview";
import { settingsSectionUpdate } from "@/domains/settings/sections";
import { SETTINGS_FIELDS, type EditableSettingsSection } from "@/domains/settings/section-config";
import { formatSettingValue } from "@/domains/settings/history";

// Batch O-1: the settings change preview and the stale-save fingerprint are pure, so they are tested without a database.
const none = { mode: "none", open: "09:00", close: "17:00" };
const validRaw: Record<string, unknown> = {
  publicBusinessName: "Robinson Rentals", publicPhone: "9705550100", publicEmail: "support@example.test",
  publicAddress: "1 Main St", hours: { mon: none, tue: none, wed: none, thu: none, fri: none, sat: none, sun: none },
  holidayClosuresText: "", facebookUrl: "", instagramUrl: "", googleUrl: "", nextdoorUrl: "", logoUrl: "",
  serviceAreaCities: "Greeley, Evans", serviceAreaZips: "80631",
  deliveryFeeDollars: 45, installationFeeDollars: 0, removalFeeDollars: 0, damageWaiverEnabled: true, depositEnabled: false,
  lateFeeGraceDays: 10, lateFeeFlatDollars: 5, lateFeePercent: 0, sixMonthPrepaySetDollars: 0, sixMonthPrepaySingleDollars: 0,
  twelveMonthPrepaySetDollars: 0, twelveMonthPrepaySingleDollars: 0, twelveMonthPrepayFreeMonthEnabled: false,
  referralRewardDollars: 25, draftReservationHoldDays: 7, receiptFileKeepDays: 30, unsentPhotoKeepDays: 1,
};

describe("stored fields per settings section", () => {
  it.each(Object.keys(SETTINGS_FIELDS) as EditableSettingsSection[])("covers every column the %s save writes", (section) => {
    const result = settingsSectionUpdate(section, validRaw);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.update).sort()).toEqual([...SECTION_STORED_KEYS[section]].sort());
  });
});

describe("section fingerprint (stale-save check)", () => {
  const row = { lateFeeGraceDays: 5, referralRewardCents: 2500, pausedAutomations: [], updatedAt: new Date("2026-10-01T00:00:00Z") };
  it("is stable and ignores key order", () => {
    expect(fieldsRevision(row, ["lateFeeGraceDays", "referralRewardCents"])).toBe(fieldsRevision(row, ["referralRewardCents", "lateFeeGraceDays"]));
  });
  it("changes when a saved field changes", () => {
    expect(sectionRevision({ ...row, lateFeeGraceDays: 7 }, "policies")).not.toBe(sectionRevision(row, "policies"));
  });
  it("does not change for unrelated columns or bookkeeping on the same row", () => {
    expect(sectionRevision({ ...row, pausedAutomations: ["x"], updatedAt: new Date() }, "policies")).toBe(sectionRevision(row, "policies"));
  });
  it("treats a missing row like empty values rather than throwing", () => {
    expect(sectionRevision(null, "profile")).toHaveLength(16);
  });
});

describe("settings change preview", () => {
  const current = { oneTimeDeliveryFeeCents: 4500, lateFeeGraceDays: 5, depositEnabled: false, publicPhone: "970", updatedAt: new Date() };
  it("lists only what would change, in plain words, with its effect", () => {
    const p = previewSettingsUpdate(current, { oneTimeDeliveryFeeCents: 5000, lateFeeGraceDays: 5, depositEnabled: true });
    expect(p.nothingToSave).toBe(false);
    expect(p.lines.map((l) => `${l.label}: ${l.from} → ${l.to}`).sort()).toEqual(["Deposits: Off → On", "Delivery fee: $45.00 → $50.00"].sort());
    expect(p.lines.find((l) => l.key === "oneTimeDeliveryFeeCents")?.effect).toMatch(/already signed keep/);
  });
  it("says nothing would change when the values match", () => {
    expect(previewSettingsUpdate(current, { lateFeeGraceDays: 5, publicPhone: "970" })).toEqual({ lines: [], nothingToSave: true });
  });
  it("never reports columns the save does not touch and never mutates its inputs", () => {
    const update = { lateFeeGraceDays: 9 };
    const before = JSON.stringify(current);
    const p = previewSettingsUpdate(current, update);
    expect(p.lines.map((l) => l.key)).toEqual(["lateFeeGraceDays"]);
    expect(JSON.stringify(current)).toBe(before);
    expect(update).toEqual({ lateFeeGraceDays: 9 });
  });
  it("is honest when it cannot say what a setting changes, and prints lists of objects without garbage", () => {
    expect(settingEffect("somethingNew")).toMatch(/not shown/);
    expect(formatSettingValue(undefined, [{ date: "2026-12-25", label: "Christmas" }])).not.toMatch(/object/);
    const p = previewSettingsUpdate({ holidayClosures: [] }, { holidayClosures: [{ date: "2026-12-25", label: "Christmas" }] });
    expect(p.lines[0].to).toMatch(/changed/);
  });
});
