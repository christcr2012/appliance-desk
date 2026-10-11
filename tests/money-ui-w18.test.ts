import { describe, expect, it } from "vitest";
import { centsAsDollars, formatMoney, moneyInputValue, parseDollarInput } from "@/lib/money-ui";

describe("W-18 consistent dollars and exact server parsing", () => {
  it("displays complete dollars and cents including negative amounts", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(3500)).toBe("$35.00");
    expect(formatMoney(-1299)).toBe("−$12.99");
    expect(moneyInputValue(7)).toBe("0.07");
  });
  it("parses dollars exactly without rounding extra decimal places", () => {
    expect(parseDollarInput(" 2,500.00 ".replace(",", ""))).toBe(250000);
    expect(parseDollarInput("0.07")).toBe(7);
    expect(parseDollarInput("35")).toBe(3500);
    expect(centsAsDollars(3500)).toBe(35);
  });
  it("rejects invented fractions, non-finite money and amounts above the approved limit", () => {
    for (const value of ["", "-1", "1.005", "0.001", "1e3", "Infinity", "NaN", "1,000", "1abc", "2.3.4"]) {
      expect(() => parseDollarInput(value)).toThrow();
    }
    expect(() => parseDollarInput("10.01", 1000)).toThrow();
    expect(() => formatMoney(1.25)).toThrow();
  });
});
