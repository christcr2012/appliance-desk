import { describe, expect, it } from "vitest";
import { wrapLine } from "@/domains/compliance/wrap-line";

describe("packet PDF line wrapping", () => {
  it("keeps every word of a long line, in order, with no line over the limit", () => {
    const long = "Standard mileage rate: 200 business miles at 72.5 cents = $145.00. The books show $500.00 of vehicle costs, shown for comparison only (parking and tolls can be added separately; your CPA confirms).";
    const lines = wrapLine(long, 105);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.length <= 105)).toBe(true);
    expect(lines.join(" ").replace(/\s+/g, " ")).toBe(long);
  });
  it("leaves short lines alone and keeps the indent on continuation lines", () => {
    expect(wrapLine("short", 105)).toEqual(["short"]);
    const lines = wrapLine(`    ${"word ".repeat(40).trim()}`, 50);
    expect(lines.slice(1).every((l) => l.startsWith("    "))).toBe(true);
  });
  it("breaks a single unbroken string at the limit instead of looping", () => {
    expect(wrapLine("x".repeat(250), 100).map((l) => l.length)).toEqual([100, 100, 50]);
  });
});
