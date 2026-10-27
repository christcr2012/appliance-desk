import { describe, expect, it } from "vitest";
import {
  accessibilityFixBy, breachPlan, clampHour, clampYears, incidentSteps, marketingTextAllowed, vendorReviewDue, yearsAgo,
  type BreachRules, type IncidentSnapshot,
} from "@/domains/security/rules";
import { renderBreachLetter } from "@/domains/security/letter";

const RULES: BreachRules = { noticeDays: 30, agThreshold: 500, bureauThreshold: 1000 };
const DAY = 86_400_000;
const base: IncidentSnapshot = {
  determinedAt: null, residentsAffected: null, residentsNotifiedAt: null,
  attorneyGeneralNotifiedAt: null, bureausNotifiedAt: null, vendorsNotifiedAt: null,
};

describe("breach duties", () => {
  const determined = new Date("2026-11-02T18:00:00Z");
  it("sets the people deadline 30 days after the decision, from the rule book value", () => {
    expect(breachPlan(determined, 10, RULES).residentsBy.getTime()).toBe(determined.getTime() + 30 * DAY);
    expect(breachPlan(determined, 10, { ...RULES, noticeDays: 45 }).residentsBy.getTime()).toBe(determined.getTime() + 45 * DAY);
  });
  it("needs the Attorney General at 500 or more, and the credit bureaus only above 1,000", () => {
    expect(breachPlan(determined, 499, RULES).needsAttorneyGeneral).toBe(false);
    expect(breachPlan(determined, 500, RULES).needsAttorneyGeneral).toBe(true);
    expect(breachPlan(determined, 1000, RULES).needsBureaus).toBe(false);
    expect(breachPlan(determined, 1001, RULES).needsBureaus).toBe(true);
  });
  it("lists only the decision step until the owner decides", () => {
    expect(incidentSteps(base, RULES).map((s) => s.key)).toEqual(["DETERMINE"]);
  });
  it("lists every owed step in order, each with the same fixed deadline, and tracks what is done", () => {
    const steps = incidentSteps({ ...base, determinedAt: determined, residentsAffected: 1200, residentsNotifiedAt: new Date() }, RULES);
    expect(steps.map((s) => s.key)).toEqual(["RESIDENTS", "ATTORNEY_GENERAL", "BUREAUS", "VENDORS"]);
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual(["RESIDENTS"]);
    expect(steps[0].due!.getTime()).toBe(steps[1].due!.getTime());
    expect(steps[3].due).toBeNull();
    expect(incidentSteps({ ...base, determinedAt: determined, residentsAffected: 5 }, RULES).map((s) => s.key)).toEqual(["RESIDENTS", "VENDORS"]);
  });
});

describe("marketing text hours (Denver clock)", () => {
  it("allows 8 am up to 9 pm and nothing outside, on both sides of daylight saving", () => {
    expect(marketingTextAllowed(new Date("2026-10-26T14:00:00Z"), 8, 21)).toBe(true);   // 8:00 am MDT
    expect(marketingTextAllowed(new Date("2026-10-26T13:59:00Z"), 8, 21)).toBe(false);  // 7:59 am MDT
    expect(marketingTextAllowed(new Date("2026-10-27T02:59:00Z"), 8, 21)).toBe(true);   // 8:59 pm MDT
    expect(marketingTextAllowed(new Date("2026-10-27T03:00:00Z"), 8, 21)).toBe(false);  // 9:00 pm MDT
    expect(marketingTextAllowed(new Date("2026-11-02T15:00:00Z"), 8, 21)).toBe(true);   // 8:00 am MST
    expect(marketingTextAllowed(new Date("2026-11-02T14:59:00Z"), 8, 21)).toBe(false);  // 7:59 am MST
  });
  it("treats equal start and end as never", () => {
    expect(marketingTextAllowed(new Date("2026-10-26T20:00:00Z"), 8, 8)).toBe(false);
  });
});

describe("dates and settings", () => {
  it("is due when never reviewed or older than the setting", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    expect(vendorReviewDue(null, now, 12)).toBe(true);
    expect(vendorReviewDue(new Date("2025-10-27T12:00:00Z"), now, 12)).toBe(false);
    expect(vendorReviewDue(new Date("2025-10-26T12:00:00Z"), now, 12)).toBe(true);
  });
  it("counts years back and complaint fix dates", () => {
    expect(yearsAgo(new Date("2026-10-26T12:00:00Z"), 2).toISOString()).toBe("2024-10-26T12:00:00.000Z");
    expect(accessibilityFixBy(new Date("2026-10-26T12:00:00Z"), 30).toISOString()).toBe("2026-11-25T12:00:00.000Z");
  });
  it("keeps odd inputs inside sensible bounds", () => {
    expect(clampYears(0, 7)).toBe(1);
    expect(clampYears(99, 7)).toBe(30);
    expect(clampYears(Number.NaN, 7)).toBe(7);
    expect(clampHour(-3, 8)).toBe(0);
    expect(clampHour(40, 8)).toBe(23);
  });
});

describe("breach letter", () => {
  const facts = {
    businessName: "Robinson Appliance Rentals", businessPhone: "970-555-0100", businessAddress: "1 Main St, Greeley, CO",
    todayText: "November 2, 2026", discoveredText: "October 30, 2026", determinedText: "November 1, 2026", whatHappened: "",
    informationInvolved: "names, phone numbers and rental records",
  };
  it("includes every item Colorado requires and the owner's own words for what was exposed", () => {
    const { body } = renderBreachLetter(facts);
    for (const needle of ["October 30, 2026", "November 1, 2026", "What information was involved: names, phone numbers and rental records", "Equifax, Experian and TransUnion", "coag.gov", "970-555-0100", "1 Main St"]) {
      expect(body).toContain(needle);
    }
    expect(body).not.toMatch(/\[[^\]]+\]/);
  });
  it("refuses to make a letter with a blank, so no placeholder is ever printed", () => {
    expect(() => renderBreachLetter({ ...facts, informationInvolved: "  " })).toThrow(/kinds of information/);
    expect(() => renderBreachLetter({ ...facts, businessPhone: "" })).toThrow(/phone/);
    expect(() => renderBreachLetter({ ...facts, businessPhone: "[Phone Number]" })).toThrow(/phone/);
    expect(() => renderBreachLetter({ ...facts, businessAddress: "[Business Address]" })).toThrow(/address/);
  });
});
