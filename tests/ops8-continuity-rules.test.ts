import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHARGE_PAUSE_RULE_KEYS, CHECKUP_ITEMS, CHECKUP_KEYS, PROFILE_TEXT_MAX, checkupDue, checkupYear, cleanProfile, cleanTicked, pausedByChargeSwitch, profileGaps,
} from "@/domains/continuity/rules";

describe("OPS-8 pause switch scope", () => {
  it("pauses jobs that start charges or send reminders, never the safety jobs", () => {
    for (const key of ["late-fees", "collections", "billing-reminders", "start-renewals:auto-renewals", "estimate-follow-ups"]) expect(pausedByChargeSwitch(key)).toBe(true);
    for (const key of ["backup", "recall-watch", "billing-reconcile:provider-ops", "billing-reconcile:bank-in-flight", "tax-rate-watch", "retention-purge", "tenant-retention"]) expect(pausedByChargeSwitch(key)).toBe(false);
    expect(new Set(CHARGE_PAUSE_RULE_KEYS).size).toBe(CHARGE_PAUSE_RULE_KEYS.length);
  });
});

describe("OPS-8 yearly check-up timing (America/Denver)", () => {
  it("is due only in December, until finished for that year", () => {
    expect(checkupDue(new Date("2026-11-30T12:00:00Z"), []).due).toBe(false);
    expect(checkupDue(new Date("2026-12-01T12:00:00Z"), [])).toEqual({ due: true, year: 2026 });
    expect(checkupDue(new Date("2026-12-15T12:00:00Z"), [2026]).due).toBe(false);
    expect(checkupDue(new Date("2026-12-15T12:00:00Z"), [2025]).due).toBe(true);
    expect(checkupDue(new Date("2027-01-02T12:00:00Z"), []).due).toBe(false);
  });
  it("uses the Denver calendar at the edges", () => {
    // 2026-12-01 02:00 UTC is still Nov 30 in Colorado; 2027-01-01 05:00 UTC is still Dec 31 there.
    expect(checkupDue(new Date("2026-12-01T02:00:00Z"), []).due).toBe(false);
    expect(checkupDue(new Date("2027-01-01T05:00:00Z"), [])).toEqual({ due: true, year: 2026 });
    expect(checkupYear(new Date("2027-01-01T05:00:00Z"))).toBe(2026);
  });
  it("every walkthrough step points at a screen that exists", () => {
    for (const item of CHECKUP_ITEMS) {
      const first = item.href.replace("/desk/", "").split("/")[0];
      expect(existsSync(`src/app/desk/${first}/page.tsx`), item.href).toBe(true);
    }
    expect(new Set(CHECKUP_KEYS).size).toBe(CHECKUP_ITEMS.length);
  });
  it("keeps only known ticks, once each, in menu order", () => {
    expect(cleanTicked(["taxes", "bogus", "insurance", "taxes"])).toEqual(["insurance", "taxes"]);
  });
});

describe("OPS-8 profile", () => {
  it("trims, empties to null and refuses over-long text rather than cutting it", () => {
    const clean = cleanProfile({ continuityCpaName: "  Pat   Lee ", continuityCpaContact: "   " });
    expect(clean.continuityCpaName).toBe("Pat Lee");
    expect(clean.continuityCpaContact).toBeNull();
    expect(() => cleanProfile({ continuityRecordsNote: "x".repeat(PROFILE_TEXT_MAX + 1) })).toThrow(/too long/);
  });
  it("names what is still missing", () => {
    expect(profileGaps({})).toHaveLength(4);
    expect(profileGaps({ continuityEmergencyName: "A", continuityEmergencyContact: "1", continuitySuccessorName: "B", continuitySuccessorContact: "2", continuityCpaName: "C", continuityCpaContact: "3", continuityRecordsNote: "safe" })).toEqual([]);
  });
});
