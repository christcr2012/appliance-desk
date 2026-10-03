import { describe, expect, it } from "vitest";
import { computeAgreementEarnings } from "@/domains/reports/earnings";

describe("computeAgreementEarnings", () => {
  it("compares one broad charge basis with net retained collections", () => {
    expect(
      computeAgreementEarnings({
        expectedChargesCents: 12_000,
        netCollectedCents: 10_000,
      }),
    ).toEqual({
      expectedChargesCents: 12_000,
      netCollectedCents: 10_000,
      gapCents: 2_000,
    });
  });

  it("allows net collections to exceed recorded charges without hiding the sign", () => {
    expect(
      computeAgreementEarnings({
        expectedChargesCents: 6_000,
        netCollectedCents: 7_000,
      }).gapCents,
    ).toBe(-1_000);
  });

  it("rejects invalid expected-charge inputs instead of silently normalizing them", () => {
    expect(() =>
      computeAgreementEarnings({
        expectedChargesCents: -1,
        netCollectedCents: 0,
      }),
    ).toThrow(/expected charges/i);
  });
});
