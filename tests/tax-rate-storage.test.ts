import { describe, expect, it } from "vitest";

import {
  formatTaxRate,
  parseTaxRatePercent,
} from "@/domains/billing/tax";

describe("exact tax-rate conversion", () => {
  it("stores ordinary percentage text as integer milli-percent", () => {
    expect(parseTaxRatePercent("7.375")).toBe(7375);
    expect(parseTaxRatePercent("7.3")).toBe(7300);
    expect(parseTaxRatePercent("0.005")).toBe(5);
  });

  it("round-trips exact milli-percent without inventing precision", () => {
    for (const text of ["7.375", "7.3", "8", "0.005", "12.5"]) {
      expect(formatTaxRate(parseTaxRatePercent(text))).toBe(`${text}%`);
    }
  });

  it("refuses invalid or over-precise rates", () => {
    for (const bad of ["", "7.3751", "abc", "-1", "101", "7,5"]) {
      expect(() => parseTaxRatePercent(bad), bad).toThrow();
    }
  });
});
