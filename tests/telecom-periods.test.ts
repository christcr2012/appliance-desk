import { describe, expect, it } from "vitest";
import { telecomReportPeriods } from "@/domains/messaging/telecom-periods";

const d = (s: string) => new Date(s + "T00:00:00Z");
describe("telecom report periods (what the nightly sync fetches)", () => {
  it("mid-month: this month so far through yesterday, and the whole month before", () => {
    const p = telecomReportPeriods(new Date("2026-10-24T09:20:00Z"));
    expect(p.current).toEqual({ start: d("2026-10-01"), end: d("2026-10-23") });
    expect(p.previous).toEqual({ start: d("2026-09-01"), end: d("2026-09-30") });
  });
  it("on the 1st there is no finished day yet, so 'current' is the month just ended", () => {
    const p = telecomReportPeriods(new Date("2026-11-01T09:20:00Z"));
    expect(p.current).toEqual({ start: d("2026-10-01"), end: d("2026-10-31") });
    expect(p.previous).toEqual({ start: d("2026-09-01"), end: d("2026-09-30") });
  });
  it("across a year boundary", () => {
    const p = telecomReportPeriods(new Date("2027-01-01T09:20:00Z"));
    expect(p.current).toEqual({ start: d("2026-12-01"), end: d("2026-12-31") });
    expect(p.previous).toEqual({ start: d("2026-11-01"), end: d("2026-11-30") });
  });
});
