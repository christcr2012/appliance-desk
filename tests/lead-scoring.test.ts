import { describe, it, expect } from "vitest";
import { scoreLead } from "@/domains/leads/scoring";
import { DEFAULT_LEAD_SCORING_POLICY } from "@/domains/leads/scoring-policy";

const score = (input: Parameters<typeof scoreLead>[0]) =>
  scoreLead(input, DEFAULT_LEAD_SCORING_POLICY);

// Ranking per docs/BUSINESS-RULES.md, lowest to highest value:
// month-to-month → 6-month → 12-month → bulk (multiple units) →
// landlord/property manager/apartment operator needing multiple units
describe("scoreLead", () => {
  it("scores a plain month-to-month individual lead at the v1 baseline", () => {
    const result = score({ desiredTerm: "month-to-month", quantity: 1, isPropertyManager: false, isBusiness: false });
    expect(result.score).toBe(0);
    expect(result.isHighValue).toBe(false);
    expect(result.reasons).toContain("Month-to-month term");
  });

  it("preserves the approved v1 ranking", () => {
    const monthToMonth = score({ desiredTerm: "month-to-month", quantity: 1, isPropertyManager: false, isBusiness: false });
    const sixMonth = score({ desiredTerm: "6-month", quantity: 1, isPropertyManager: false, isBusiness: false });
    const twelveMonth = score({ desiredTerm: "12-month", quantity: 1, isPropertyManager: false, isBusiness: false });
    const bulk = score({ desiredTerm: "12-month", quantity: 4, isPropertyManager: false, isBusiness: false });
    const propertyManager = score({ desiredTerm: "12-month", quantity: 4, isPropertyManager: true, isBusiness: true });
    expect(sixMonth.score).toBeGreaterThan(monthToMonth.score);
    expect(twelveMonth.score).toBeGreaterThan(sixMonth.score);
    expect(bulk.score).toBeGreaterThan(twelveMonth.score);
    expect(propertyManager.score).toBeGreaterThan(bulk.score);
  });

  it("flags high-value leads and explains the awarded dimensions", () => {
    const result = score({ desiredTerm: "12-month", quantity: 3, isPropertyManager: true, isBusiness: true });
    expect(result.isHighValue).toBe(true);
    expect(result.reasons).toContain("Flagged high-value");
    expect(result.reasons.some((r) => r.includes("bulk"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("property manager"))).toBe(true);
  });

  it("does not grant the multi-unit property-manager premium for one unit", () => {
    const one = score({ desiredTerm: "month-to-month", quantity: 1, isPropertyManager: true, isBusiness: true });
    const twelve = score({ desiredTerm: "12-month", quantity: 1, isPropertyManager: false, isBusiness: false });
    expect(one.score).toBeLessThan(twelve.score);
    expect(one.isHighValue).toBe(false);
    expect(one.reasons.some((reason) => reason.includes("property manager"))).toBe(false);
  });

  it("uses custom weights and threshold without changing the scoring algorithm", () => {
    const custom = {
      ...DEFAULT_LEAD_SCORING_POLICY,
      version: 7,
      termPoints: { ...DEFAULT_LEAD_SCORING_POLICY.termPoints, "6-month": 40 },
      additionalUnitPoints: 1,
      businessAccountPoints: 2,
      multiUnitPropertyManagerPoints: 3,
      highValueThreshold: 35,
    };
    const result = scoreLead(
      { desiredTerm: "6-month", quantity: 1, isPropertyManager: false, isBusiness: false },
      custom,
    );
    expect(result.score).toBe(40);
    expect(result.isHighValue).toBe(true);
  });
});
