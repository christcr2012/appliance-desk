import { describe, expect, it } from "vitest";
import {
  businessWeekStart,
  formatMonthYear,
  formatShortDate,
  formatWeekdayDate,
  ordinal,
  relativeBusinessDay,
} from "@/lib/business-date";

// AR-0a: the kit's date words (KIT section 8). Every helper is checked around both 2026 daylight-saving changes
// (spring forward Sunday Mar 8, fall back Sunday Nov 1) and New Year, in Colorado time, whatever the server's zone.

/** A Colorado wall-clock time written with its UTC offset (MST -07:00, MDT -06:00). */
const at = (iso: string) => new Date(iso);

describe("formatShortDate", () => {
  const now = at("2026-10-25T12:00:00-06:00");
  it("leaves the year off in the current Colorado year", () => {
    expect(formatShortDate(at("2026-10-25T09:00:00-06:00"), now)).toBe("Oct 25");
    expect(formatShortDate(at("2026-03-08T01:30:00-07:00"), now)).toBe("Mar 8"); // just before spring forward
    expect(formatShortDate(at("2026-03-08T03:30:00-06:00"), now)).toBe("Mar 8"); // just after spring forward
    expect(formatShortDate(at("2026-11-01T01:30:00-06:00"), now)).toBe("Nov 1"); // first 1:30 on fall back
    expect(formatShortDate(at("2026-11-01T01:30:00-07:00"), now)).toBe("Nov 1"); // second 1:30 on fall back
  });
  it("adds the year otherwise", () => {
    expect(formatShortDate(at("2025-10-25T09:00:00-06:00"), now)).toBe("Oct 25, 2025");
  });
  it("uses the Colorado date and year at New Year, not UTC's", () => {
    // 11:30 pm Dec 31 in Colorado is already Jan 1 in UTC.
    const lateNewYearsEve = at("2026-12-31T23:30:00-07:00");
    expect(formatShortDate(lateNewYearsEve, now)).toBe("Dec 31");
    expect(formatShortDate(lateNewYearsEve, at("2027-01-01T00:30:00-07:00"))).toBe("Dec 31, 2026");
    expect(formatShortDate(at("2027-01-01T00:30:00-07:00"), lateNewYearsEve)).toBe("Jan 1, 2027");
  });
});

describe("formatMonthYear", () => {
  it("names the Colorado month", () => {
    expect(formatMonthYear(at("2026-03-08T03:00:00-06:00"))).toBe("March 2026");
    expect(formatMonthYear(at("2026-11-01T01:30:00-07:00"))).toBe("November 2026");
    expect(formatMonthYear(at("2026-12-31T23:30:00-07:00"))).toBe("December 2026");
    expect(formatMonthYear(at("2027-01-01T00:00:00-07:00"))).toBe("January 2027");
  });
});

describe("formatWeekdayDate", () => {
  it("gives the weekday and short date", () => {
    expect(formatWeekdayDate(at("2026-10-25T08:00:00-06:00"))).toBe("Sunday, Oct 25");
    expect(formatWeekdayDate(at("2026-03-08T00:30:00-07:00"))).toBe("Sunday, Mar 8");
    expect(formatWeekdayDate(at("2026-03-08T23:30:00-06:00"))).toBe("Sunday, Mar 8");
    expect(formatWeekdayDate(at("2026-11-01T23:30:00-07:00"))).toBe("Sunday, Nov 1");
    expect(formatWeekdayDate(at("2026-12-31T23:30:00-07:00"))).toBe("Thursday, Dec 31");
    expect(formatWeekdayDate(at("2027-01-01T00:30:00-07:00"))).toBe("Friday, Jan 1");
  });
});

describe("relativeBusinessDay", () => {
  it("counts Colorado calendar days across spring forward (a 23-hour day)", () => {
    const now = at("2026-03-07T23:00:00-07:00");
    expect(relativeBusinessDay(at("2026-03-07T00:10:00-07:00"), now)).toBe("today");
    expect(relativeBusinessDay(at("2026-03-08T23:30:00-06:00"), now)).toBe("tomorrow");
    expect(relativeBusinessDay(at("2026-03-09T00:30:00-06:00"), now)).toBe("in 2 days");
    expect(relativeBusinessDay(at("2026-03-06T23:59:00-07:00"), now)).toBe("yesterday");
  });
  it("counts Colorado calendar days across fall back (a 25-hour day)", () => {
    const now = at("2026-11-01T23:30:00-07:00");
    expect(relativeBusinessDay(at("2026-11-01T00:05:00-06:00"), now)).toBe("today");
    expect(relativeBusinessDay(at("2026-10-31T12:00:00-06:00"), now)).toBe("yesterday");
    expect(relativeBusinessDay(at("2026-10-29T12:00:00-06:00"), now)).toBe("3 days ago");
    expect(relativeBusinessDay(at("2026-11-04T09:00:00-07:00"), now)).toBe("in 3 days");
  });
  it("crosses New Year and falls back to the short date beyond six days", () => {
    const now = at("2026-12-31T23:30:00-07:00");
    expect(relativeBusinessDay(at("2027-01-01T00:30:00-07:00"), now)).toBe("tomorrow");
    expect(relativeBusinessDay(at("2027-01-06T12:00:00-07:00"), now)).toBe("in 6 days");
    expect(relativeBusinessDay(at("2027-01-07T12:00:00-07:00"), now)).toBe("Jan 7, 2027");
    expect(relativeBusinessDay(at("2026-12-25T12:00:00-07:00"), now)).toBe("6 days ago");
    expect(relativeBusinessDay(at("2026-12-24T12:00:00-07:00"), now)).toBe("Dec 24");
  });
});

describe("businessWeekStart", () => {
  it("is Monday 00:00 Colorado time, including a Sunday", () => {
    expect(businessWeekStart(at("2026-10-25T20:00:00-06:00")).toISOString()).toBe("2026-10-19T06:00:00.000Z");
    expect(businessWeekStart(at("2026-10-19T00:00:00-06:00")).toISOString()).toBe("2026-10-19T06:00:00.000Z");
    expect(businessWeekStart(at("2026-10-18T23:59:00-06:00")).toISOString()).toBe("2026-10-12T06:00:00.000Z");
  });
  it("handles the spring-forward week (Monday was still standard time)", () => {
    // Sunday Mar 8 after the change belongs to the week that started Monday Mar 2 at 00:00 MST.
    expect(businessWeekStart(at("2026-03-08T12:00:00-06:00")).toISOString()).toBe("2026-03-02T07:00:00.000Z");
    // The next Monday starts at 00:00 MDT.
    expect(businessWeekStart(at("2026-03-09T08:00:00-06:00")).toISOString()).toBe("2026-03-09T06:00:00.000Z");
  });
  it("handles the fall-back week (Monday was still daylight time)", () => {
    expect(businessWeekStart(at("2026-11-01T22:00:00-07:00")).toISOString()).toBe("2026-10-26T06:00:00.000Z");
    expect(businessWeekStart(at("2026-11-02T00:00:00-07:00")).toISOString()).toBe("2026-11-02T07:00:00.000Z");
  });
  it("crosses New Year", () => {
    // Friday Jan 1 2027 belongs to the week of Monday Dec 28 2026.
    expect(businessWeekStart(at("2027-01-01T00:30:00-07:00")).toISOString()).toBe("2026-12-28T07:00:00.000Z");
    // In UTC it is already Monday Jan 4, but in Colorado it is still Sunday Jan 3.
    expect(businessWeekStart(at("2027-01-03T22:00:00-07:00")).toISOString()).toBe("2026-12-28T07:00:00.000Z");
  });
});

describe("ordinal", () => {
  it.each([
    [1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [11, "11th"], [12, "12th"], [13, "13th"],
    [21, "21st"], [22, "22nd"], [23, "23rd"], [28, "28th"], [31, "31st"], [101, "101st"], [111, "111th"],
  ])("%i → %s", (n, word) => {
    expect(ordinal(n)).toBe(word);
  });
});
