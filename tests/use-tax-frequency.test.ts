import { describe, expect, it } from "vitest";
import { chooseUseTaxFrequency } from "@/domains/tax/use-tax-frequency";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

const monthEnd = (key: string) => businessDateFromKey(key)!;

describe("Colorado consumer use-tax frequency", () => {
  it("keeps $300 annual through a $300 threshold", () => {
    const result = chooseUseTaxFrequency({
      yearDueCents: 30000, thresholdCents: 30000,
      currentFrequency: "ANNUAL", monthEnd: monthEnd("2026-10-31"),
    });
    expect(result.frequency).toBe("ANNUAL");
    expect(businessDateKey(result.effectiveFrom)).toBe("2026-11-01");
  });

  it("changes to monthly only for the next period after $300.01", () => {
    const result = chooseUseTaxFrequency({
      yearDueCents: 30001, thresholdCents: 30000,
      currentFrequency: "ANNUAL", monthEnd: monthEnd("2026-10-31"),
    });
    expect(result.frequency).toBe("MONTHLY");
    expect(businessDateKey(result.effectiveFrom)).toBe("2026-11-01");
  });

  it("keeps a monthly election and crosses Denver's year boundary", () => {
    const result = chooseUseTaxFrequency({
      yearDueCents: 0, thresholdCents: 30000,
      currentFrequency: "MONTHLY", monthEnd: monthEnd("2026-12-31"),
    });
    expect(result.frequency).toBe("MONTHLY");
    expect(businessDateKey(result.effectiveFrom)).toBe("2027-01-01");
  });

  it("rejects mid-month and fractional-cent transitions", () => {
    expect(() => chooseUseTaxFrequency({
      yearDueCents: 30001, thresholdCents: 30000,
      currentFrequency: "ANNUAL", monthEnd: monthEnd("2026-10-30"),
    })).toThrow(/end of a calendar month/);
    expect(() => chooseUseTaxFrequency({
      yearDueCents: 30000.5, thresholdCents: 30000,
      currentFrequency: "ANNUAL", monthEnd: monthEnd("2026-10-31"),
    })).toThrow(/integer cents/);
  });
});
