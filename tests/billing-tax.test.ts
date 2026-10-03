import { describe, expect, it } from "vitest";
import { sumTax, taxCentsForLine } from "@/domains/billing/tax";

describe("line-level tax rounding", () => {
  it("calculates 7.3% of $60.00 as 438 cents", () => {
    expect(taxCentsForLine(6_000, 73)).toBe(438);
  });

  it("rounds 7.3% of one cent down to zero", () => {
    expect(taxCentsForLine(1, 73)).toBe(0);
  });

  it("rounds each line independently rather than taxing a naive aggregate", () => {
    const lines = [{ amountCents: 7 }, { amountCents: 7 }, { amountCents: 7 }];
    expect(sumTax(lines, 73)).toBe(3);
    expect(taxCentsForLine(21, 73)).toBe(2);
  });

  it("keeps the sign for negative adjustments", () => {
    expect(taxCentsForLine(-6_000, 73)).toBe(-438);
  });
});
