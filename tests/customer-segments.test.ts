import { describe, expect, it } from "vitest";
import {
  customerSegments,
  type CustomerSegmentFacts,
} from "@/domains/customers/segments";

// 2026-10-29 09:00 in Denver (MDT, UTC-6): start of today Denver = 06:00Z.
const NOW = new Date("2026-10-29T15:00:00.000Z");
const START_TODAY = new Date("2026-10-29T06:00:00.000Z");
const ENDING_DAYS = 14; // window end = start of Nov 12 Denver

function facts(over: Partial<CustomerSegmentFacts> = {}): CustomerSegmentFacts {
  return {
    activeCount: 0,
    pendingCount: 0,
    endedCount: 0,
    oldestOpenDueDate: null,
    endingOn: null,
    pickupAt: null,
    ...over,
  };
}

describe("customerSegments rule table", () => {
  it("setting-up: pending and none active", () => {
    expect(customerSegments(facts({ pendingCount: 2 }), NOW, ENDING_DAYS)).toEqual(["setting-up"]);
  });

  it("active: at least one active agreement", () => {
    expect(customerSegments(facts({ activeCount: 1 }), NOW, ENDING_DAYS)).toEqual(["active"]);
  });

  it("owes: oldest open due date before the Denver start of today", () => {
    const due = new Date(START_TODAY.getTime() - 60_000);
    expect(customerSegments(facts({ activeCount: 1, oldestOpenDueDate: due }), NOW, ENDING_DAYS))
      .toEqual(["active", "owes"]);
  });

  it("not owes when the oldest bill is due today or later", () => {
    expect(customerSegments(facts({ activeCount: 1, oldestOpenDueDate: START_TODAY }), NOW, ENDING_DAYS))
      .toEqual(["active"]);
  });

  it("ending: end date inside the notice window", () => {
    const ends = new Date("2026-11-05T06:00:00.000Z");
    expect(customerSegments(facts({ activeCount: 1, endingOn: ends }), NOW, ENDING_DAYS))
      .toEqual(["active", "ending"]);
  });

  it("ending: a scheduled pickup inside the window counts too", () => {
    const pickup = new Date("2026-11-01T15:00:00.000Z");
    expect(customerSegments(facts({ activeCount: 1, pickupAt: pickup }), NOW, ENDING_DAYS))
      .toEqual(["active", "ending"]);
  });

  it("not ending when the end date is beyond the window", () => {
    const ends = new Date("2026-12-25T06:00:00.000Z");
    expect(customerSegments(facts({ activeCount: 1, endingOn: ends }), NOW, ENDING_DAYS))
      .toEqual(["active"]);
  });

  it("past: nothing live, something ended", () => {
    expect(customerSegments(facts({ endedCount: 3 }), NOW, ENDING_DAYS)).toEqual(["past"]);
  });

  it("not past while a new rental is setting up", () => {
    expect(customerSegments(facts({ endedCount: 1, pendingCount: 1 }), NOW, ENDING_DAYS))
      .toEqual(["setting-up"]);
  });

  it("new: none of the above", () => {
    expect(customerSegments(facts(), NOW, ENDING_DAYS)).toEqual(["new"]);
  });

  it("a past-due bill makes even a no-agreement customer 'owes', not 'new'", () => {
    const due = new Date("2026-10-01T06:00:00.000Z");
    expect(customerSegments(facts({ oldestOpenDueDate: due }), NOW, ENDING_DAYS)).toEqual(["owes"]);
  });

  it("multi-segment: active + owes + ending together", () => {
    const due = new Date("2026-10-20T06:00:00.000Z");
    const ends = new Date("2026-11-03T06:00:00.000Z");
    expect(
      customerSegments(facts({ activeCount: 2, oldestOpenDueDate: due, endingOn: ends }), NOW, ENDING_DAYS),
    ).toEqual(["active", "owes", "ending"]);
  });
});
