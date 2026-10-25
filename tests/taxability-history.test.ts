import { describe, expect, it } from "vitest";
import { resolveTaxabilityAsOf, type TaxabilityCell } from "@/domains/tax/taxability-history";

const BASE = new Date("1970-01-01T00:00:00Z");
const CHANGE_DAY = new Date("2026-11-01T06:00:00Z"); // Denver start of Nov 1 (still daylight time at midnight)
const created = new Date("2026-10-25T18:00:00Z");

const cell = (taxability: TaxabilityCell["taxability"], provisional = false, jurisdictionId: string | null = null) =>
  ({ jurisdictionId, category: "DELIVERY" as const, taxability, provisional });

function find(cells: TaxabilityCell[], jurisdictionId: string | null = null) {
  return cells.find((row) => row.jurisdictionId === jurisdictionId && row.category === "DELIVERY");
}

describe("taxability rules on a date", () => {
  it("after a change is applied, old dates keep the old rule and new dates get the new one", () => {
    const current = [cell("EXEMPT")];
    const versions = [
      { ...cell("TAXABLE"), effectiveFrom: BASE, createdAt: created },
      { ...cell("EXEMPT"), effectiveFrom: CHANGE_DAY, createdAt: created },
    ];
    expect(find(resolveTaxabilityAsOf(new Date("2026-10-15T18:00:00Z"), current, versions, []))?.taxability)
      .toBe("TAXABLE");
    expect(find(resolveTaxabilityAsOf(new Date("2026-11-02T18:00:00Z"), current, versions, []))?.taxability)
      .toBe("EXEMPT");
  });

  it("uses the Denver day boundary, including the daylight-saving change", () => {
    const current = [cell("EXEMPT")];
    const versions = [
      { ...cell("TAXABLE"), effectiveFrom: BASE, createdAt: created },
      { ...cell("EXEMPT"), effectiveFrom: CHANGE_DAY, createdAt: created },
    ];
    // 23:59 on Oct 31 in Denver.
    expect(find(resolveTaxabilityAsOf(new Date("2026-11-01T05:59:00Z"), current, versions, []))?.taxability)
      .toBe("TAXABLE");
    // 00:00 on Nov 1 in Denver.
    expect(find(resolveTaxabilityAsOf(CHANGE_DAY, current, versions, []))?.taxability).toBe("EXEMPT");
  });

  it("applies a scheduled change from its date before the nightly run has applied it", () => {
    const current = [cell("TAXABLE")];
    const versions = [{ ...cell("TAXABLE"), effectiveFrom: BASE, createdAt: created }];
    const scheduled = [{ ...cell("EXEMPT", true), effectiveFrom: CHANGE_DAY, createdAt: created }];
    const before = find(resolveTaxabilityAsOf(new Date("2026-10-31T18:00:00Z"), current, versions, scheduled));
    expect(before).toEqual(cell("TAXABLE"));
    const onTheDay = find(resolveTaxabilityAsOf(new Date("2026-11-01T18:00:00Z"), current, versions, scheduled));
    expect(onTheDay).toEqual(cell("EXEMPT", true));
  });

  it("creates a cell from a scheduled change even when no rule is stored yet", () => {
    const scheduled = [{ ...cell("TAXABLE", false, "greeley"), effectiveFrom: CHANGE_DAY, createdAt: created }];
    expect(find(resolveTaxabilityAsOf(new Date("2026-11-03T18:00:00Z"), [], [], scheduled), "greeley")?.taxability)
      .toBe("TAXABLE");
    expect(find(resolveTaxabilityAsOf(new Date("2026-10-03T18:00:00Z"), [], [], scheduled), "greeley")).toBeUndefined();
  });

  it("the newest scheduled change wins when two are due", () => {
    const scheduled = [
      { ...cell("TAXABLE"), effectiveFrom: CHANGE_DAY, createdAt: created },
      { ...cell("EXEMPT"), effectiveFrom: new Date("2026-11-05T07:00:00Z"), createdAt: created },
    ];
    expect(find(resolveTaxabilityAsOf(new Date("2026-11-06T18:00:00Z"), [cell("UNDECIDED")], [], scheduled))
      ?.taxability).toBe("EXEMPT");
  });

  it("trusts the stored rule for every date when it was changed outside the dated saves", () => {
    const versions = [
      { ...cell("TAXABLE"), effectiveFrom: BASE, createdAt: created },
      { ...cell("EXEMPT"), effectiveFrom: CHANGE_DAY, createdAt: created },
    ];
    // The stored rule says TAXABLE now, but the newest version says EXEMPT: history is not trustworthy.
    expect(find(resolveTaxabilityAsOf(new Date("2026-11-02T18:00:00Z"), [cell("TAXABLE")], versions, []))
      ?.taxability).toBe("TAXABLE");
    expect(find(resolveTaxabilityAsOf(new Date("2026-10-02T18:00:00Z"), [cell("TAXABLE")], versions, []))
      ?.taxability).toBe("TAXABLE");
  });

  it("keeps today's behaviour for rules without history, and drops rules that were removed", () => {
    expect(resolveTaxabilityAsOf(new Date(), [cell("TAXABLE", true)], [], [])).toEqual([cell("TAXABLE", true)]);
    expect(resolveTaxabilityAsOf(new Date(), [], [{ ...cell("TAXABLE"), effectiveFrom: BASE, createdAt: created }], []))
      .toEqual([]);
  });

  it("uses the stored rule when the only history starts later than the date asked about", () => {
    const versions = [{ ...cell("EXEMPT"), effectiveFrom: CHANGE_DAY, createdAt: created }];
    expect(find(resolveTaxabilityAsOf(new Date("2026-10-02T18:00:00Z"), [cell("EXEMPT")], versions, []))
      ?.taxability).toBe("EXEMPT");
  });
});
