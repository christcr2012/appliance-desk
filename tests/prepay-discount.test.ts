import { describe, it, expect } from "vitest";
import {
  calculatePrepayDiscountCentsPerMonth,
  isFreeMonthEarned,
} from "@/domains/pricing/prepay-discount";

// Chris's own words, kept verbatim in the source file's comment: "i need 6
// months paid in advance to get a $5/month discount and 1 year paid in
// advance to receive $10 per month discount for sets, and half the
// discount for single units, and these discounts also need to be
// adjustable by the owner." Confirmed with him directly (not guessed):
// the discount is earned by the AGREEMENT'S TERM (6 or 12 months), and a
// "set" is 2+ appliances on the same rental line.
const settings = {
  sixMonthPrepayDiscountSetCents: 500,
  sixMonthPrepayDiscountSingleCents: 250,
  twelveMonthPrepayDiscountSetCents: 1000,
  twelveMonthPrepayDiscountSingleCents: 500,
};

describe("calculatePrepayDiscountCentsPerMonth", () => {
  it("gives the 6-month SET rate for 2+ appliances on a 6-month term", () => {
    expect(calculatePrepayDiscountCentsPerMonth(6, 2, settings)).toBe(500);
    expect(calculatePrepayDiscountCentsPerMonth(6, 3, settings)).toBe(500);
  });

  it("gives the 6-month SINGLE rate for exactly 1 appliance on a 6-month term", () => {
    expect(calculatePrepayDiscountCentsPerMonth(6, 1, settings)).toBe(250);
  });

  it("gives the 12-month SET rate for 2+ appliances on a 12-month term", () => {
    expect(calculatePrepayDiscountCentsPerMonth(12, 2, settings)).toBe(1000);
  });

  it("gives the 12-month SINGLE rate for exactly 1 appliance on a 12-month term", () => {
    expect(calculatePrepayDiscountCentsPerMonth(12, 1, settings)).toBe(500);
  });

  it("gives no discount for month-to-month (null term)", () => {
    expect(calculatePrepayDiscountCentsPerMonth(null, 2, settings)).toBe(0);
    expect(calculatePrepayDiscountCentsPerMonth(null, 1, settings)).toBe(0);
  });

  it("gives no discount for any term other than 6 or 12", () => {
    expect(calculatePrepayDiscountCentsPerMonth(3, 2, settings)).toBe(0);
    expect(calculatePrepayDiscountCentsPerMonth(24, 1, settings)).toBe(0);
  });

  it("never derives the single-unit rate from the set rate — they're fully independent settings", () => {
    // Chris was explicit that these must NOT be locked to a 2:1 (or any
    // other) ratio in code — a lopsided, non-halved single rate must still
    // be honored exactly as configured.
    const lopsided = {
      sixMonthPrepayDiscountSetCents: 500,
      sixMonthPrepayDiscountSingleCents: 999, // deliberately NOT half of 500
      twelveMonthPrepayDiscountSetCents: 1000,
      twelveMonthPrepayDiscountSingleCents: 1,
    };
    expect(calculatePrepayDiscountCentsPerMonth(6, 1, lopsided)).toBe(999);
    expect(calculatePrepayDiscountCentsPerMonth(12, 1, lopsided)).toBe(1);
  });
});

describe("isFreeMonthEarned", () => {
  it("is earned on a 12-month term, paid fully in advance, with the bonus enabled", () => {
    expect(isFreeMonthEarned(12, true, true)).toBe(true);
  });

  it("is never earned on any term other than 12, even if paid in advance", () => {
    expect(isFreeMonthEarned(6, true, true)).toBe(false);
    expect(isFreeMonthEarned(null, true, true)).toBe(false);
  });

  it("is never earned unless the customer actually paid in advance", () => {
    expect(isFreeMonthEarned(12, false, true)).toBe(false);
  });

  it("is never earned when the owner has turned the bonus off, even if everything else qualifies", () => {
    expect(isFreeMonthEarned(12, true, false)).toBe(false);
  });
});
