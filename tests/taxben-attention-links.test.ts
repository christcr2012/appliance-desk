import { describe, expect, it } from "vitest";
import {
  capitalizationPolicyException,
  retirementComparisonException,
} from "@/domains/exceptions/rules";

// PR #705 review: every Tax benefits To do must land on the tax year it is
// about — the benefits page defaults to the current year when no year is
// given, which is the wrong year for both of these reminders.
describe("tax benefits Today links", () => {
  it("links the January–March retirement reminder to the prior tax year", () => {
    const item = retirementComparisonException({ year: 2027, since: new Date(0) });
    expect(item.title).toContain("2026");
    expect(item.href).toBe("/desk/sales-tax/benefits?year=2026");
  });

  it("links the December policy renewal to the renewal year", () => {
    const item = capitalizationPolicyException({ year: 2027, renewal: true, since: new Date(0) });
    expect(item.href).toBe("/desk/sales-tax/benefits?year=2027");
  });
});
