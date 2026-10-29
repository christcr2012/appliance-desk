import { describe, expect, it } from "vitest";
import { businessDateTimeFromLocal } from "@/lib/business-date";
import { businessMinutesBetween, hasAnyOpeningHours } from "@/lib/business-hours";
import type { StoredHours } from "@/domains/settings/profile-extras";

// AR-9: speed-to-lead counts only opening hours. All instants are Denver
// wall times via businessDateTimeFromLocal, so DST cases are real.
const at = (local: string) => businessDateTimeFromLocal(local)!;

const WEEKDAYS_9_TO_5: StoredHours = {
  mon: { open: "09:00", close: "17:00" },
  tue: { open: "09:00", close: "17:00" },
  wed: { open: "09:00", close: "17:00" },
  thu: { open: "09:00", close: "17:00" },
  fri: { open: "09:00", close: "17:00" },
  sat: { closed: true },
  sun: { closed: true },
};

describe("businessMinutesBetween", () => {
  it("counts only the minutes inside one day's hours", () => {
    // Monday 2026-10-05: created 08:00 (before opening), contacted 10:30.
    expect(businessMinutesBetween(at("2026-10-05T08:00"), at("2026-10-05T10:30"), WEEKDAYS_9_TO_5)).toBe(90);
    // Fully inside.
    expect(businessMinutesBetween(at("2026-10-05T10:00"), at("2026-10-05T11:15"), WEEKDAYS_9_TO_5)).toBe(75);
    // Fully outside (evening).
    expect(businessMinutesBetween(at("2026-10-05T18:00"), at("2026-10-05T19:00"), WEEKDAYS_9_TO_5)).toBe(0);
  });

  it("spans overnight: the evening tail does not count, the next morning does", () => {
    // Monday 16:30 -> Tuesday 09:30 = 30 (Mon) + 30 (Tue).
    expect(businessMinutesBetween(at("2026-10-05T16:30"), at("2026-10-06T09:30"), WEEKDAYS_9_TO_5)).toBe(60);
  });

  it("skips closed weekend days", () => {
    // Friday 16:00 -> Monday 10:00 = 60 (Fri) + 60 (Mon).
    expect(businessMinutesBetween(at("2026-10-02T16:00"), at("2026-10-05T10:00"), WEEKDAYS_9_TO_5)).toBe(120);
  });

  it("skips holiday closures", () => {
    // Wednesday 2026-11-25 16:00 -> Friday 2026-11-27 10:00, with Thursday
    // 2026-11-26 a closure: 60 (Wed) + 0 (Thu) + 60 (Fri).
    expect(
      businessMinutesBetween(at("2026-11-25T16:00"), at("2026-11-27T10:00"), WEEKDAYS_9_TO_5, new Set(["2026-11-26"])),
    ).toBe(120);
    // Without the closure the same span also counts all of Thursday.
    expect(businessMinutesBetween(at("2026-11-25T16:00"), at("2026-11-27T10:00"), WEEKDAYS_9_TO_5)).toBe(600);
  });

  it("counts every minute when no hours are set", () => {
    expect(hasAnyOpeningHours({})).toBe(false);
    expect(businessMinutesBetween(at("2026-10-03T12:00"), at("2026-10-05T12:00"), {})).toBe(2 * 24 * 60);
  });

  it("is real elapsed time across the spring-forward jump when no hours are set", () => {
    // 2026-03-07 23:00 MST -> 2026-03-08 03:30 MDT is 3.5 real hours (the
    // 02:00 hour does not exist), not 4.5 wall hours.
    expect(businessMinutesBetween(at("2026-03-07T23:00"), at("2026-03-08T03:30"), {})).toBe(210);
  });

  it("keeps a full 8-hour business day on both DST transition days", () => {
    const withSunday: StoredHours = { ...WEEKDAYS_9_TO_5, sun: { open: "09:00", close: "17:00" } };
    // Spring forward, Sunday 2026-03-08.
    expect(businessMinutesBetween(at("2026-03-08T08:00"), at("2026-03-08T18:00"), withSunday)).toBe(480);
    // Fall back, Sunday 2026-11-01 (the repeated hour is before opening).
    expect(businessMinutesBetween(at("2026-11-01T08:00"), at("2026-11-01T18:00"), withSunday)).toBe(480);
  });

  it("returns 0 for an empty or backwards span", () => {
    expect(businessMinutesBetween(at("2026-10-05T10:00"), at("2026-10-05T10:00"), WEEKDAYS_9_TO_5)).toBe(0);
    expect(businessMinutesBetween(at("2026-10-05T11:00"), at("2026-10-05T10:00"), WEEKDAYS_9_TO_5)).toBe(0);
  });
});
