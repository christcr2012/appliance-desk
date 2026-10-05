import { describe, expect, it } from "vitest";
import { centsInWords } from "@/lib/money-words";

describe("amounts in words", () => {
  it.each([
    [0, "zero dollars"],
    [1, "zero dollars and one cent"],
    [100, "one dollar"],
    [4550, "forty-five dollars and fifty cents"],
    [1999, "nineteen dollars and ninety-nine cents"],
    [10000, "one hundred dollars"],
    [123456, "one thousand two hundred thirty-four dollars and fifty-six cents"],
    [2000000, "twenty thousand dollars"],
    [100000000, "one million dollars"],
  ])("%i cents", (cents, words) => {
    expect(centsInWords(cents)).toBe(words);
  });
  it("gives nothing for a bad amount", () => {
    expect(centsInWords(-5)).toBe("");
    expect(centsInWords(1.5)).toBe("");
    expect(centsInWords(Number.NaN)).toBe("");
  });
});
