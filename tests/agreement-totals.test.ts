import { describe, expect, it } from "vitest";

import { rentalMonthlyTotalCents } from "../src/domains/agreements/totals";

describe("rentalMonthlyTotalCents", () => {
  it("is 0 for an agreement with no lines", () => {
    expect(rentalMonthlyTotalCents([])).toBe(0);
  });

  it("sums the monthly price of every line in integer cents", () => {
    expect(
      rentalMonthlyTotalCents([
        { monthlyPriceCents: 4500 },
        { monthlyPriceCents: 4500 },
        { monthlyPriceCents: 1200 },
      ]),
    ).toBe(10200);
  });

  it("keeps a zero-priced line at zero", () => {
    expect(
      rentalMonthlyTotalCents([
        { monthlyPriceCents: 0 },
        { monthlyPriceCents: 9900 },
      ]),
    ).toBe(9900);
  });

  it("throws on a fractional-cent price instead of rounding it", () => {
    expect(() => rentalMonthlyTotalCents([{ monthlyPriceCents: 45.5 }])).toThrow(
      /integer cents/,
    );
  });

  it("throws on NaN and non-finite prices", () => {
    expect(() => rentalMonthlyTotalCents([{ monthlyPriceCents: Number.NaN }])).toThrow(
      /integer cents/,
    );
    expect(
      () => rentalMonthlyTotalCents([{ monthlyPriceCents: Number.POSITIVE_INFINITY }]),
    ).toThrow(/integer cents/);
  });
});
