import { describe, it, expect } from "vitest";
import { scoreLead } from "@/domains/leads/scoring";

// Ranking per docs/BUSINESS-RULES.md, lowest to highest value:
// month-to-month → 6-month → 12-month → bulk (multiple units) →
// landlord/property manager/apartment operator needing multiple units
describe("scoreLead", () => {
  it("scores a plain month-to-month individual lead at the baseline", () => {
    const result = scoreLead({
      desiredTerm: "month-to-month",
      quantity: 1,
      isPropertyManager: false,
      isBusiness: false,
    });
    expect(result.score).toBe(0);
    expect(result.isHighValue).toBe(false);
    expect(result.reasons).toContain("Month-to-month term");
  });

  it("ranks 6-month above month-to-month", () => {
    const monthToMonth = scoreLead({
      desiredTerm: "month-to-month",
      quantity: 1,
      isPropertyManager: false,
      isBusiness: false,
    });
    const sixMonth = scoreLead({
      desiredTerm: "6-month",
      quantity: 1,
      isPropertyManager: false,
      isBusiness: false,
    });
    expect(sixMonth.score).toBeGreaterThan(monthToMonth.score);
  });

  it("ranks 12-month above 6-month", () => {
    const sixMonth = scoreLead({
      desiredTerm: "6-month",
      quantity: 1,
      isPropertyManager: false,
      isBusiness: false,
    });
    const twelveMonth = scoreLead({
      desiredTerm: "12-month",
      quantity: 1,
      isPropertyManager: false,
      isBusiness: false,
    });
    expect(twelveMonth.score).toBeGreaterThan(sixMonth.score);
  });

  it("ranks bulk (multiple units) above a single unit at the same term", () => {
    const single = scoreLead({
      desiredTerm: "12-month",
      quantity: 1,
      isPropertyManager: false,
      isBusiness: false,
    });
    const bulk = scoreLead({
      desiredTerm: "12-month",
      quantity: 4,
      isPropertyManager: false,
      isBusiness: false,
    });
    expect(bulk.score).toBeGreaterThan(single.score);
    expect(bulk.reasons.some((r) => r.includes("bulk"))).toBe(true);
  });

  it("ranks a property manager needing multiple units highest of all", () => {
    const bulk = scoreLead({
      desiredTerm: "12-month",
      quantity: 4,
      isPropertyManager: false,
      isBusiness: false,
    });
    const propertyManager = scoreLead({
      desiredTerm: "12-month",
      quantity: 4,
      isPropertyManager: true,
      isBusiness: true,
    });
    expect(propertyManager.score).toBeGreaterThan(bulk.score);
    expect(
      propertyManager.reasons.some((r) => r.includes("property manager")),
    ).toBe(true);
  });

  it("flags high-value leads and explains every point awarded", () => {
    const result = scoreLead({
      desiredTerm: "12-month",
      quantity: 3,
      isPropertyManager: true,
      isBusiness: true,
    });
    expect(result.isHighValue).toBe(true);
    expect(result.reasons).toContain("Flagged high-value");
    // Every point on the board must have a plain-English reason attached —
    // never a black-box score (docs/BUSINESS-RULES.md).
    expect(result.reasons.length).toBeGreaterThan(1);
  });

  it("does not flag a low-scoring lead as high-value", () => {
    const result = scoreLead({
      desiredTerm: "month-to-month",
      quantity: 1,
      isPropertyManager: false,
      isBusiness: false,
    });
    expect(result.isHighValue).toBe(false);
    expect(result.reasons).not.toContain("Flagged high-value");
  });
});

it("does not grant the multi-unit property-manager premium for one unit", () => {
  const one = scoreLead({ desiredTerm: "month-to-month", quantity: 1, isPropertyManager: true, isBusiness: true });
  const twelve = scoreLead({ desiredTerm: "12-month", quantity: 1, isPropertyManager: false, isBusiness: false });
  expect(one.score).toBeLessThan(twelve.score);
  expect(one.isHighValue).toBe(false);
  expect(one.reasons.some(reason => reason.includes("property manager"))).toBe(false);
});
