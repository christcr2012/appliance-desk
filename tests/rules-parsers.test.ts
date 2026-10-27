import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { businessDateKey } from "@/lib/business-date";
import { parserForKey } from "@/domains/rules/parsers/index";
import { parseRdfRates } from "@/domains/rules/parsers/rdf-rates";
import { parseCoInterest } from "@/domains/rules/parsers/co-interest";
import { parseGreeleyRate } from "@/domains/rules/parsers/greeley-rate";
import { parseIrs1099Threshold } from "@/domains/rules/parsers/irs-1099-threshold";

// TFA-3 section 13/16: parser fixtures mirror the real official pages as
// captured on 2026-10-26 (same headings, labels and values), in the raw
// HTML form the safe fetch returns. No network: parsers are pure.

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "fixtures", "official-pages", name), "utf8");

describe("TFA-3 RDF rates parser", () => {
  it("reads every July column, with the six parts summing to the total", () => {
    const result = parseRdfRates(fixture("rdf-rates.html"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.map((value) => [businessDateKey(value.effectiveFrom!), value.value])).toEqual([
      ["2023-07-01", 28],
      ["2024-07-01", 29],
      ["2025-07-01", 28],
      ["2026-07-01", 31],
    ]);
    expect(result.values.every((value) => value.ruleKey === "co.rdf.amount")).toBe(true);
    expect(result.evidence).toContain("Total Retail Delivery Fee");
  });

  it("fails when the layout changes", () => {
    const result = parseRdfRates(fixture("rdf-rates-changed-layout.html"));
    expect(result.ok).toBe(false);
  });

  it("fails when the six parts do not add up to the stated total", () => {
    const result = parseRdfRates(fixture("rdf-rates-bad-sum.html"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toContain("do not add up");
  });

  it("fails when a part row is missing (partial table)", () => {
    const partial = fixture("rdf-rates.html").replace(/<tr><td>Clean Transit[^<]*<\/td>.*?<\/tr>/, "");
    const result = parseRdfRates(partial);
    expect(result.ok).toBe(false);
  });
});

describe("TFA-3 Colorado interest parser", () => {
  it("reads each year's regular and discounted rates", () => {
    const result = parseCoInterest(fixture("co-interest.html"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byYear = new Map(result.values.map((value) => [
      businessDateKey(value.effectiveFrom!), value.value,
    ]));
    expect(byYear.get("2026-01-01")).toEqual({ regular: 11, discounted: 8 });
    expect(byYear.get("2027-01-01")).toEqual({ regular: 10, discounted: 7 });
    expect(result.values.every((value) => value.ruleKey === "co.interest")).toBe(true);
  });

  it("fails when the table header changes", () => {
    expect(parseCoInterest(fixture("co-interest-changed-layout.html")).ok).toBe(false);
  });
});

describe("TFA-3 IRS 1099 threshold parser", () => {
  it("reads the shared threshold and the December revision's tax year", () => {
    const result = parseIrs1099Threshold(fixture("irs-1099.html"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values).toHaveLength(1);
    expect(result.values[0]!.ruleKey).toBe("us.1099.threshold");
    expect(result.values[0]!.value).toBe(200000);
    expect(businessDateKey(result.values[0]!.effectiveFrom!)).toBe("2026-01-01");
  });

  it("fails when rents and nonemployee compensation disagree", () => {
    const result = parseIrs1099Threshold(fixture("irs-1099-mismatch.html"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toContain("differ");
  });

  it("fails without the December revision stamp", () => {
    const june = fixture("irs-1099.html").replace("(12/2026)", "(06/2026)");
    expect(parseIrs1099Threshold(june).ok).toBe(false);
  });
});

describe("TFA-3 Greeley rate parser", () => {
  it("reads the city rate with no stated date as a null date", () => {
    const result = parseGreeleyRate(fixture("greeley-rate.html"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values[0]!.ruleKey).toBe("greeley.sales_rate");
    expect(result.values[0]!.value).toBe(4110);
    expect(result.values[0]!.effectiveFrom).toBeNull();
  });

  it("reads a stated effective date when the page gives one", () => {
    const result = parseGreeleyRate(fixture("greeley-rate-dated.html"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values[0]!.value).toBe(4710);
    expect(businessDateKey(result.values[0]!.effectiveFrom!)).toBe("2027-01-01");
  });

  it("fails when the page states no rate", () => {
    expect(parseGreeleyRate(fixture("greeley-rate-missing.html")).ok).toBe(false);
  });
});

describe("TFA-3 parser dispatch", () => {
  it("maps each parser key and returns null for hash-only watches", () => {
    expect(parserForKey("RDF_RATES")).toBe(parseRdfRates);
    expect(parserForKey("CO_INTEREST")).toBe(parseCoInterest);
    expect(parserForKey("GREELEY_RATE")).toBe(parseGreeleyRate);
    expect(parserForKey("IRS_1099_THRESHOLD")).toBe(parseIrs1099Threshold);
    expect(parserForKey(null)).toBeNull();
    expect(parserForKey("SOMETHING_ELSE")).toBeNull();
  });
});
