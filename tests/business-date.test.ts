import { describe, expect, it } from "vitest";
import {
  billingPeriodFor,
  businessDateEnd,
  businessDateKey,
  businessDayBounds,
  businessEndOfDay,
  businessMonthBounds,
  formatBusinessTime,
  formatTaskDate,
  taskDueBucket,
} from "@/lib/business-date";

describe("Colorado business calendar independent of server timezone", () => {
  it.each([
    [
      "2026-09-30T05:59:59Z",
      "2026-09-29",
      "2026-09-29T06:00:00.000Z",
      "2026-09-30T06:00:00.000Z",
    ],
    [
      "2026-09-30T06:00:00Z",
      "2026-09-30",
      "2026-09-30T06:00:00.000Z",
      "2026-10-01T06:00:00.000Z",
    ],
    [
      "2026-03-08T12:00:00Z",
      "2026-03-08",
      "2026-03-08T07:00:00.000Z",
      "2026-03-09T06:00:00.000Z",
    ],
    [
      "2026-11-01T12:00:00Z",
      "2026-11-01",
      "2026-11-01T06:00:00.000Z",
      "2026-11-02T07:00:00.000Z",
    ],
    [
      "2027-01-01T06:59:59Z",
      "2026-12-31",
      "2026-12-31T07:00:00.000Z",
      "2027-01-01T07:00:00.000Z",
    ],
  ])(
    "resolves %s to its actual local-day interval",
    (input, key, start, end) => {
      const now = new Date(input);
      expect(businessDateKey(now)).toBe(key);
      const bounds = businessDayBounds(now);
      expect(bounds.start.toISOString()).toBe(start);
      expect(bounds.end.toISOString()).toBe(end);
    },
  );

  it.each([
    [
      "2026-03-15T12:00:00Z",
      "2026-03-01T07:00:00.000Z",
      "2026-04-01T06:00:00.000Z",
    ],
    [
      "2026-10-15T12:00:00Z",
      "2026-10-01T06:00:00.000Z",
      "2026-11-01T06:00:00.000Z",
    ],
    [
      "2026-11-15T12:00:00Z",
      "2026-11-01T06:00:00.000Z",
      "2026-12-01T07:00:00.000Z",
    ],
  ])("resolves the Colorado month containing %s across DST", (input, start, end) => {
    const bounds = businessMonthBounds(new Date(input));
    expect(bounds.start.toISOString()).toBe(start);
    expect(bounds.end.toISOString()).toBe(end);
  });

  it.each([
    ["2026-03-08", "2026-03-09T05:59:59.000Z"],
    ["2026-11-01", "2026-11-02T06:59:59.000Z"],
    ["2026-09-30", "2026-10-01T05:59:59.000Z"],
  ])("resolves the final whole second of %s across DST safely", (key, expected) => {
    expect(businessDateEnd(key).toISOString()).toBe(expected);
  });

  it("resolves the business end of day from an instant", () => {
    expect(businessEndOfDay(new Date("2026-03-08T18:00:00Z")).toISOString()).toBe(
      "2026-03-09T05:59:59.000Z",
    );
  });

  it("keeps a March DST-transition billing anchor on the same local wall clock", () => {
    const anchor = new Date("2026-03-08T08:30:00Z"); // 1:30 AM MST
    const period = billingPeriodFor(anchor, 1);
    expect(businessDateKey(period.start)).toBe("2026-04-08");
    expect(formatBusinessTime(period.start)).toBe("1:30 AM MDT");
    expect(period.start.toISOString()).toBe("2026-04-08T07:30:00.000Z");
  });

  it("keeps a November DST-transition billing anchor on the same local wall clock", () => {
    const anchor = new Date("2026-11-01T07:30:00Z"); // first 1:30 AM, MDT
    const period = billingPeriodFor(anchor, 1);
    expect(businessDateKey(period.start)).toBe("2026-12-01");
    expect(formatBusinessTime(period.start)).toBe("1:30 AM MST");
    expect(period.start.toISOString()).toBe("2026-12-01T08:30:00.000Z");
  });

  it("clamps a month-end billing anchor instead of overflowing into the next month", () => {
    const anchor = new Date("2026-01-31T19:00:00Z"); // Jan 31 noon MST
    const period = billingPeriodFor(anchor, 1);
    expect(businessDateKey(period.start)).toBe("2026-02-28");
    expect(formatBusinessTime(period.start)).toBe("12:00 PM MST");
  });

  it("rejects an invalid end-date key instead of guessing", () => {
    expect(() => businessDateEnd("2026-02-30")).toThrow(/invalid business date/i);
  });

  it("does not shift a date-only deadline into the previous evening", () => {
    const due = new Date("2026-09-30");
    expect(formatTaskDate(due)).toBe("Sep 30, 2026");
    expect(taskDueBucket(due, new Date("2026-09-30T05:59:59Z"))).toBe(
      "upcoming",
    );
    expect(taskDueBucket(due, new Date("2026-10-01T05:59:59Z"))).toBe("today");
    expect(taskDueBucket(due, new Date("2026-10-01T06:00:00Z"))).toBe(
      "overdue",
    );
    expect(taskDueBucket(null)).toBe("undated");
  });

  it("labels the repeated fall-back hour with its actual timezone", () => {
    expect(formatBusinessTime(new Date("2026-11-01T07:30:00Z"))).toBe(
      "1:30 AM MDT",
    );
    expect(formatBusinessTime(new Date("2026-11-01T08:30:00Z"))).toBe(
      "1:30 AM MST",
    );
  });
});
