import { describe, expect, it } from "vitest";
import { businessDateTimeFromLocal } from "@/lib/business-date";

describe("businessDateTimeFromLocal", () => {
  it("reads a winter time as Mountain Standard (UTC-7)", () => {
    expect(businessDateTimeFromLocal("2026-01-15T09:30")?.toISOString()).toBe("2026-01-15T16:30:00.000Z");
  });
  it("reads a summer time as Mountain Daylight (UTC-6)", () => {
    expect(businessDateTimeFromLocal("2026-07-15T09:30")?.toISOString()).toBe("2026-07-15T15:30:00.000Z");
  });
  it("handles the spring-forward day (2026-03-08): before and after the jump", () => {
    expect(businessDateTimeFromLocal("2026-03-08T01:30")?.toISOString()).toBe("2026-03-08T08:30:00.000Z");
    expect(businessDateTimeFromLocal("2026-03-08T03:30")?.toISOString()).toBe("2026-03-08T09:30:00.000Z");
  });
  it("rejects a time that does not exist when clocks spring forward", () => {
    expect(businessDateTimeFromLocal("2026-03-08T02:30")).toBeNull();
  });
  it("picks the first occurrence of the repeated fall-back hour (2026-11-01)", () => {
    expect(businessDateTimeFromLocal("2026-11-01T01:30")?.toISOString()).toBe("2026-11-01T07:30:00.000Z");
    expect(businessDateTimeFromLocal("2026-11-01T03:30")?.toISOString()).toBe("2026-11-01T10:30:00.000Z");
  });
  it("handles midnight and month-end", () => {
    expect(businessDateTimeFromLocal("2026-01-31T00:00")?.toISOString()).toBe("2026-01-31T07:00:00.000Z");
    expect(businessDateTimeFromLocal("2026-02-28T23:59")?.toISOString()).toBe("2026-03-01T06:59:00.000Z");
  });
  it("rejects malformed or impossible input", () => {
    expect(businessDateTimeFromLocal("")).toBeNull();
    expect(businessDateTimeFromLocal("2026-02-30T10:00")).toBeNull();
    expect(businessDateTimeFromLocal("2026-01-15 09:30")).toBeNull();
  });
});
