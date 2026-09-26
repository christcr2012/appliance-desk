import { describe, it, expect } from "vitest";
import { formatCents, dollarsToCents } from "@/domains/pricing";

describe("formatCents", () => {
  it("formats a whole-dollar amount with no decimal", () => {
    expect(formatCents(3500)).toBe("$35");
  });

  it("formats a fractional amount with cents", () => {
    expect(formatCents(3450)).toBe("$34.50");
  });

  it("formats zero", () => {
    expect(formatCents(0)).toBe("$0");
  });
});

// dollarsToCents is what converts every dollar amount typed into
// /desk/settings (fees, appliance prices) into the integer cents the
// database actually stores — see docs/BUSINESS-RULES.md ("money is
// stored as integer cents, never floating point"). Floating-point
// dollar math (45.1 + 0.05, etc.) is exactly the kind of input that
// breaks a naive `dollars * 100` without rounding, so that's the case
// worth actually testing here, not just the easy whole-dollar ones.
describe("dollarsToCents", () => {
  it("converts a whole-dollar amount", () => {
    expect(dollarsToCents(45)).toBe(4500);
  });

  it("converts a fractional amount", () => {
    expect(dollarsToCents(34.5)).toBe(3450);
  });

  it("converts zero", () => {
    expect(dollarsToCents(0)).toBe(0);
  });

  it("rounds away floating-point imprecision instead of truncating", () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE-754 floating point —
    // a plain `Math.trunc`/cast-to-int would silently produce 1998
    // cents ($19.98) instead of the $19.99 the owner actually typed.
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
  });
});
