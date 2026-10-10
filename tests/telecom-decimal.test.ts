import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  telecomDecimal, reportedTelecomSpend, sumComparableTelecomAmounts,
  roundTelecomTotalToCents,
} from "@/domains/messaging/telecom-decimal";

describe("COM-L10 exact signed telecom decimals", () => {
  it("preserves exact 10-decimal precision and accepts full 24-digit precision", () => {
    expect(telecomDecimal("99999999999999.9999999999").toString())
      .toBe("99999999999999.9999999999");
    expect(telecomDecimal("-0.0000000001").toString()).toBe("-1e-10");
    expect(telecomDecimal(new Prisma.Decimal("3.0000000001")).toFixed(10))
      .toBe("3.0000000001");
    expect(telecomDecimal(new Prisma.Decimal("0.0000000001")).toFixed(10))
      .toBe("0.0000000001");
    expect(roundTelecomTotalToCents(new Prisma.Decimal("-0.0000000001"))).toBe(0);
    expect(() => telecomDecimal(new Prisma.Decimal("0.00000000001"))).toThrow(RangeError);
  });
  it("rejects floating input, nonfinite/exponent, out-of-precision and malformed numbers", () => {
    for (const value of [1.005, NaN, Infinity]) {
      expect(() => telecomDecimal(value as unknown as string)).toThrow(TypeError);
    }
    for (const value of ["1e-2", "NaN", "Infinity", "00.10", "1.00000000001",
      "100000000000000.00", "1.", "1,000.00", " 2.5 "]) {
      expect(() => telecomDecimal(value)).toThrow(RangeError);
    }
  });
  it("distinguishes resource price sign from Usage sign without abs", () => {
    expect(reportedTelecomSpend("-0.0075000000", "TWILIO_RESOURCE")?.toFixed(10))
      .toBe("0.0075000000");
    expect(reportedTelecomSpend("0.0075000000", "TWILIO_RESOURCE")?.toFixed(10))
      .toBe("-0.0075000000"); // resource refund
    expect(reportedTelecomSpend("-0.0075000000", "TWILIO_USAGE")?.toFixed(10))
      .toBe("-0.0075000000"); // usage adjustment
    expect(reportedTelecomSpend(null, "TWILIO_USAGE")).toBeNull();
  });
  it("never combines evidence basis or currency, never converts unknown to zero", () => {
    const base = { classification: "PROVIDER_REPORTED" as const, currency: "USD" };
    expect(sumComparableTelecomAmounts([
      { ...base, amount: "0.1000000000" }, { ...base, amount: "-0.0500000000" },
    ])?.amount.toFixed(10)).toBe("0.0500000000");
    expect(sumComparableTelecomAmounts([
      { ...base, amount: "1.00" }, { ...base, amount: null },
    ])).toBeNull();
    expect(sumComparableTelecomAmounts([])).toBeNull();
    expect(() => sumComparableTelecomAmounts([
      { ...base, amount: "1" }, { ...base, currency: "EUR", amount: "2" },
    ])).toThrow("Cannot sum");
    expect(() => sumComparableTelecomAmounts([
      { ...base, amount: "1" },
      { ...base, classification: "INVOICE_RECONCILED", amount: "2" },
    ])).toThrow("Cannot sum");
  });
  it("rounds only aggregated dollars to safe integer cents, including signed half cent", () => {
    const component = [
      { amount: "0.005", currency: "USD", classification: "PROVIDER_REPORTED" as const },
      { amount: "0.005", currency: "USD", classification: "PROVIDER_REPORTED" as const },
      { amount: "-0.004", currency: "USD", classification: "PROVIDER_REPORTED" as const },
    ];
    const total = sumComparableTelecomAmounts(component);
    expect(total).not.toBeNull();
    expect(roundTelecomTotalToCents(total!.amount)).toBe(1); // 0.006 dollars
    expect(roundTelecomTotalToCents("1.005")).toBe(101);
    expect(roundTelecomTotalToCents("-1.005")).toBe(-101);
    expect(roundTelecomTotalToCents("0.0049999999")).toBe(0);
    expect(roundTelecomTotalToCents("-0.005")).toBe(-1);
    expect(roundTelecomTotalToCents(null)).toBeNull();
    expect(() => roundTelecomTotalToCents("99999999999999")).toThrow(RangeError);
  });
});
