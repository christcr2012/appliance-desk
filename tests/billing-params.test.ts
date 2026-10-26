import { describe, expect, it } from "vitest";
import { defaultBillSort, hasBillFilters, legacyBillsRedirect, parseBillsParams } from "@/app/desk/billing/params";

describe("Money › Bills URL (MONEY-BILLS 1)", () => {
  it("defaults to Open, oldest due first", () => {
    expect(parseBillsParams({})).toEqual({ status: "open", sort: "due-asc", q: undefined, type: undefined, due: undefined, autopay: undefined, view: undefined, open: undefined, cursor: undefined });
    expect(defaultBillSort("paid")).toBe("due-desc");
    expect(parseBillsParams({ status: "closed" }).sort).toBe("due-desc");
  });

  it("reads every param and drops bad values instead of failing", () => {
    const parsed = parseBillsParams({ status: "past-due", q: " 1042 ", type: "rent,bogus,sale,rent", due: "custom", from: "2026-10-01", to: "nope", autopay: "on", sort: "owed-desc", view: "deposits", open: "i_1", cursor: "abc" });
    expect(parsed).toMatchObject({ status: "past-due", q: "1042", type: ["rent", "sale"], due: { preset: "custom", from: "2026-10-01", to: undefined }, autopay: "on", sort: "owed-desc", view: "deposits", open: "i_1", cursor: "abc" });
    const bad = parseBillsParams({ status: "nope", sort: "random", autopay: "maybe", view: "x", open: "<script>", q: "x".repeat(200), due: "never" });
    expect(bad).toMatchObject({ status: "open", sort: "due-asc", autopay: undefined, view: undefined, open: undefined, q: undefined, due: undefined });
    expect(parseBillsParams({ status: "processing" }).status).toBe("open");
    expect(parseBillsParams({ status: ["paid", "open"] }).status).toBe("paid");
  });

  it("old ?filter= links redirect; others stay", () => {
    expect(legacyBillsRedirect({ filter: "delinquent", page: "2" })).toBe("/desk/billing?status=past-due");
    expect(legacyBillsRedirect({ filter: "statements" })).toBe("/desk/billing?view=by-customer");
    expect(legacyBillsRedirect({ filter: "deposits" })).toBe("/desk/billing?view=deposits");
    expect(legacyBillsRedirect({ filter: "waiting" })).toBe("/desk/billing?view=waiting");
    expect(legacyBillsRedirect({ filter: "other" })).toBeNull();
    expect(legacyBillsRedirect({ status: "open" })).toBeNull();
  });

  it("knows when filters narrow the list", () => {
    expect(hasBillFilters(parseBillsParams({}))).toBe(false);
    expect(hasBillFilters(parseBillsParams({ q: "maria" }))).toBe(true);
    expect(hasBillFilters(parseBillsParams({ autopay: "off" }))).toBe(true);
  });
});
