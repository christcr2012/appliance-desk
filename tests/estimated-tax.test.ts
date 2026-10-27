import { describe, expect, it } from "vitest";

import { HIGH_INCOME_AGI_CENTS, quarterOfPeriodKey, safeHarbor, yearOfPeriodKey } from "@/domains/compliance/estimates";

/**
 * CMP-2: the safe-harbor math behind the quarterly estimates. Federal
 * rules (and the 2026 DR 0104EP instructions for Colorado): 100% of
 * last year's tax, 110% when last year's federal AGI is over $150,000,
 * a quarter of the annual figure per payment.
 */
describe("estimated tax safe harbor", () => {
  it("is 100% of last year's tax at or under the $150,000 AGI line", () => {
    expect(safeHarbor(400_000, 9_000_000)).toEqual({ ratePercent: 100, annualCents: 400_000, quarterCents: 100_000 });
    expect(safeHarbor(400_000, HIGH_INCOME_AGI_CENTS).ratePercent).toBe(100); // exactly at the line is not over it
    expect(safeHarbor(400_000, null).ratePercent).toBe(100); // no AGI recorded: the lower rate, never a guess upward
  });

  it("is 110% when last year's AGI is over $150,000", () => {
    expect(safeHarbor(400_000, HIGH_INCOME_AGI_CENTS + 1)).toEqual({
      ratePercent: 110,
      annualCents: 440_000,
      quarterCents: 110_000,
    });
  });

  it("rounds the quarterly figure to whole cents", () => {
    const harbor = safeHarbor(100_001, null);
    expect(harbor.annualCents).toBe(100_001);
    expect(harbor.quarterCents).toBe(25_000);
  });

  it("reads the year and quarter out of filing period keys", () => {
    expect(yearOfPeriodKey("2026")).toBe(2026);
    expect(yearOfPeriodKey("2026-Q3")).toBe(2026);
    expect(quarterOfPeriodKey("2026-Q3")).toBe(3);
    expect(quarterOfPeriodKey("2026-Q5")).toBeNull();
    expect(quarterOfPeriodKey("2026")).toBeNull();
  });
});
