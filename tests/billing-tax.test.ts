import { describe, expect, it } from "vitest";
import {
  formatTaxRate,
  parseTaxRatePercent,
  permilleToMilliPercent,
  sumTax,
  taxCentsForLine,
} from "@/domains/billing/tax";

describe("taxCentsForLine (rate in thousandths of a percent)", () => {
  it("7.3% on $60.00 is exactly $4.38", () => {
    expect(taxCentsForLine(6000, 7300)).toBe(438);
  });

  it("7.3% on one cent is zero cents", () => {
    expect(taxCentsForLine(1, 7300)).toBe(0);
  });

  it("supports the owner's 7.375% example exactly", () => {
    // 7.375% of $100.00 = $7.375 -> half-up $7.38
    expect(taxCentsForLine(10_000, 7375)).toBe(738);
    // 7.375% of $80.00 = $5.90 exactly
    expect(taxCentsForLine(8000, 7375)).toBe(590);
  });

  it("rounds exact halves up, and just under a half down", () => {
    expect(taxCentsForLine(5, 10_000)).toBe(1); // 0.5 cents -> 1
    expect(taxCentsForLine(4, 12_500)).toBe(1); // 0.5 cents -> 1
    expect(taxCentsForLine(499, 100)).toBe(0); // 0.499 cents -> 0
    expect(taxCentsForLine(500, 100)).toBe(1); // 0.5 cents -> 1
  });

  it("a zero rate or zero amount is zero tax", () => {
    expect(taxCentsForLine(6000, 0)).toBe(0);
    expect(taxCentsForLine(0, 7375)).toBe(0);
  });

  it("negative lines (discounts) round symmetrically", () => {
    expect(taxCentsForLine(-6000, 7300)).toBe(-438);
    expect(taxCentsForLine(-5, 10_000)).toBe(-1);
  });

  it("stays exact for large amounts where floating point would drift", () => {
    // $9,999,999.99 at 7.375%: 999_999_999 * 7375 / 100_000 = 73_749_999.926... -> 73_750_000
    expect(taxCentsForLine(999_999_999, 7375)).toBe(73_750_000);
  });

  it("rejects fractions, negative rates and rates over 100%", () => {
    expect(() => taxCentsForLine(10.5, 7300)).toThrow();
    expect(() => taxCentsForLine(100, 7300.5)).toThrow();
    expect(() => taxCentsForLine(100, -1)).toThrow();
    expect(() => taxCentsForLine(100, 100_001)).toThrow();
  });
});

describe("sumTax (per-line rounding, then sum)", () => {
  it("three 5-cent lines at 10% tax 1 cent each, not once on the 15-cent total", () => {
    const perLine = sumTax([5, 5, 5], 10_000);
    const onceOnTotal = taxCentsForLine(15, 10_000);
    expect(perLine).toBe(3);
    expect(onceOnTotal).toBe(2);
    expect(perLine).not.toBe(onceOnTotal);
  });

  it("accepts line objects and mixes in a discount line", () => {
    expect(sumTax([{ amountCents: 6000 }, { amountCents: 1500 }, { amountCents: -500 }], 7300)).toBe(
      438 + 110 - 37, // 1500*7.3% = 109.5 -> 110; -500*7.3% = -36.5 -> -37
    );
  });

  it("no lines means no tax", () => {
    expect(sumTax([], 7375)).toBe(0);
  });
});

describe("converting and displaying rates", () => {
  it("converts the existing tenths-of-a-percent values without losing meaning", () => {
    expect(permilleToMilliPercent(73)).toBe(7300);
    expect(permilleToMilliPercent(0)).toBe(0);
    expect(permilleToMilliPercent(1000)).toBe(100_000);
  });

  it("formats rates for the owner without trailing zeros", () => {
    expect(formatTaxRate(7375)).toBe("7.375%");
    expect(formatTaxRate(7300)).toBe("7.3%");
    expect(formatTaxRate(8000)).toBe("8%");
    expect(formatTaxRate(0)).toBe("0%");
    expect(formatTaxRate(100_000)).toBe("100%");
    expect(formatTaxRate(5)).toBe("0.005%");
  });

  it("parses typed percentages exactly and refuses extra precision", () => {
    expect(parseTaxRatePercent("7.375")).toBe(7375);
    expect(parseTaxRatePercent(" 7.375% ")).toBe(7375);
    expect(parseTaxRatePercent("7.3")).toBe(7300);
    expect(parseTaxRatePercent("8")).toBe(8000);
    expect(parseTaxRatePercent("0")).toBe(0);
    expect(parseTaxRatePercent("100")).toBe(100_000);
    expect(() => parseTaxRatePercent("7.3755")).toThrow();
    expect(() => parseTaxRatePercent("100.001")).toThrow();
    expect(() => parseTaxRatePercent("-1")).toThrow();
    expect(() => parseTaxRatePercent("abc")).toThrow();
    expect(() => parseTaxRatePercent("")).toThrow();
  });

  it("round-trips: parse then format", () => {
    for (const text of ["7.375", "7.3", "8", "0.005", "12.5"]) {
      expect(formatTaxRate(parseTaxRatePercent(text))).toBe(`${text}%`);
    }
  });
});

