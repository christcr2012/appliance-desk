import { describe, expect, it } from "vitest";
import {
  billingPeriodFor,
  businessDateEnd,
  businessEndOfDay,
  fixedTermEndDate,
  businessDateKey,
  businessDayBounds,
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

describe("anniversary billing periods", () => {
  const iso = (d: Date) => d.toISOString();

  it.each([
    // anchor instant, monthsAhead, expected start, expected end
    ["2026-03-08T19:00:00Z", 0, "2026-03-08T07:00:00.000Z", "2026-04-08T06:00:00.000Z"],
    ["2026-03-08T19:00:00Z", 1, "2026-04-08T06:00:00.000Z", "2026-05-08T06:00:00.000Z"],
    ["2026-11-01T19:00:00Z", 0, "2026-11-01T06:00:00.000Z", "2026-12-01T07:00:00.000Z"],
    ["2026-11-01T19:00:00Z", 1, "2026-12-01T07:00:00.000Z", "2027-01-01T07:00:00.000Z"],
    ["2026-12-15T19:00:00Z", 1, "2027-01-15T07:00:00.000Z", "2027-02-15T07:00:00.000Z"],
  ])("anchor %s period %i keeps the Colorado calendar day", (anchor, n, start, end) => {
    const period = billingPeriodFor(new Date(anchor), n);
    expect(iso(period.start)).toBe(start);
    expect(iso(period.end)).toBe(end);
  });

  it("a Mar 8 anchor still bills on the 8th a year later, after the clocks changed twice", () => {
    expect(iso(billingPeriodFor(new Date("2026-03-08T19:00:00Z"), 12).start)).toBe(
      "2027-03-08T07:00:00.000Z",
    );
  });

  it("uses the Colorado date of the anchor, not the UTC date", () => {
    // 05:30Z on Mar 9 is still the evening of Mar 8 in Colorado.
    const period = billingPeriodFor(new Date("2026-03-09T05:30:00Z"), 0);
    expect(iso(period.start)).toBe("2026-03-08T07:00:00.000Z");
  });

  it("clamps a 31st anchor to short months without drifting", () => {
    const anchor = new Date("2026-01-31T19:00:00Z");
    expect(iso(billingPeriodFor(anchor, 1).start)).toBe("2026-02-28T07:00:00.000Z");
    expect(iso(billingPeriodFor(anchor, 2).start)).toBe("2026-03-31T06:00:00.000Z");
    expect(iso(billingPeriodFor(anchor, 3).start)).toBe("2026-04-30T06:00:00.000Z");
  });

  it("honors a leap day", () => {
    expect(iso(billingPeriodFor(new Date("2028-01-31T19:00:00Z"), 1).start)).toBe(
      "2028-02-29T07:00:00.000Z",
    );
  });

  it("periods tile with no gap or overlap across both DST changes", () => {
    const anchor = new Date("2026-01-31T19:00:00Z");
    for (let n = 0; n < 24; n++) {
      expect(iso(billingPeriodFor(anchor, n).end)).toBe(iso(billingPeriodFor(anchor, n + 1).start));
    }
  });

  it("rejects a negative or fractional month count", () => {
    expect(() => billingPeriodFor(new Date(), -1)).toThrow();
    expect(() => billingPeriodFor(new Date(), 1.5)).toThrow();
  });
});

describe("businessEndOfDay", () => {
  it("is the last second of the Colorado day, on a 23-hour and a 25-hour day", () => {
    expect(businessEndOfDay(new Date("2026-03-08T12:00:00Z")).toISOString()).toBe(
      "2026-03-09T05:59:59.000Z",
    );
    expect(businessEndOfDay(new Date("2026-11-01T12:00:00Z")).toISOString()).toBe(
      "2026-11-02T06:59:59.000Z",
    );
  });
});

describe("fixedTermEndDate (a term starts at delivery)", () => {
  it.each([
    ["2026-11-08T19:00:00Z", 12, "2027-11-08T06:59:59.000Z"],
    ["2026-11-08T19:00:00Z", 6, "2027-05-08T05:59:59.000Z"],
    // starts the 1st: the term ends on the last day of the month before
    ["2026-10-01T18:00:00Z", 12, "2027-10-01T05:59:59.000Z"],
    // 31st anchors clamp: six months from Jan 31 ends before Jul 31
    ["2026-01-31T19:00:00Z", 6, "2026-07-31T05:59:59.000Z"],
  ])("start %s for %i months ends %s", (start, months, end) => {
    expect(fixedTermEndDate(new Date(start), months).toISOString()).toBe(end);
  });

  it("is the last second before the first day of the next term, so terms never overlap or leave a gap", () => {
    const start = new Date("2026-03-08T19:00:00Z");
    const end = fixedTermEndDate(start, 12);
    expect(end.getTime() + 1000).toBe(billingPeriodFor(start, 12).start.getTime());
  });

  it("rejects a zero, negative or fractional term", () => {
    expect(() => fixedTermEndDate(new Date(), 0)).toThrow();
    expect(() => fixedTermEndDate(new Date(), 2.5)).toThrow();
  });
});
