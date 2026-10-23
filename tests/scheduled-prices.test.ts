import { describe, expect, it } from "vitest";
import { MAX_SCHEDULED_PRICE_CENTS, scheduleInputProblem } from "@/domains/pricing/scheduled";

// Pure rules for scheduled price changes (O-4). Colorado calendar days, no clock of the machine involved.
const now = new Date("2026-10-23T18:00:00Z"); // Friday afternoon in Colorado

const ok = { applianceTypeId: "t", newPriceCents: 6_000, effectiveOn: "2026-11-01" };

describe("scheduleInputProblem", () => {
  it("accepts a future Colorado day and a normal price", () => {
    expect(scheduleInputProblem(ok, now)).toBeNull();
    expect(scheduleInputProblem({ ...ok, newPriceCents: 0 }, now)).toBeNull();
  });
  it("refuses today, yesterday and impossible dates", () => {
    expect(scheduleInputProblem({ ...ok, effectiveOn: "2026-10-23" }, now)).toMatch(/after today/);
    expect(scheduleInputProblem({ ...ok, effectiveOn: "2026-10-01" }, now)).toMatch(/after today/);
    expect(scheduleInputProblem({ ...ok, effectiveOn: "2026-02-31" }, now)).toMatch(/valid start date/);
    expect(scheduleInputProblem({ ...ok, effectiveOn: "tomorrow" }, now)).toMatch(/valid start date/);
  });
  it("uses the Colorado day, not the UTC day, for 'today'", () => {
    // 03:00 UTC on Oct 24 is still the evening of Oct 23 in Colorado, so Oct 24 is tomorrow.
    const lateEvening = new Date("2026-10-24T03:00:00Z");
    expect(scheduleInputProblem({ ...ok, effectiveOn: "2026-10-24" }, lateEvening)).toBeNull();
    expect(scheduleInputProblem({ ...ok, effectiveOn: "2026-10-23" }, lateEvening)).toMatch(/after today/);
  });
  it("accepts the daylight-saving change day", () => {
    expect(scheduleInputProblem({ ...ok, effectiveOn: "2026-11-01" }, now)).toBeNull();
  });
  it("refuses more than a year ahead", () => {
    expect(scheduleInputProblem({ ...ok, effectiveOn: "2028-01-01" }, now)).toMatch(/within the next year/);
  });
  it("refuses negative, fractional-cent and absurd prices", () => {
    expect(scheduleInputProblem({ ...ok, newPriceCents: -1 }, now)).toMatch(/valid price/);
    expect(scheduleInputProblem({ ...ok, newPriceCents: 10.5 }, now)).toMatch(/valid price/);
    expect(scheduleInputProblem({ ...ok, newPriceCents: MAX_SCHEDULED_PRICE_CENTS + 1 }, now)).toMatch(/\$10,000/);
  });
  it("keeps notes short", () => {
    expect(scheduleInputProblem({ ...ok, note: "x".repeat(301) }, now)).toMatch(/300/);
  });
});
