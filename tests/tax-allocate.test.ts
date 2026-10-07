import { describe, expect, it } from "vitest";

import { allocateAcrossLines } from "@/domains/tax/allocate";

describe("allocateAcrossLines", () => {
  it("uses largest remainder and preserves the total", () => {
    const allocation = allocateAcrossLines(10, [1, 1, 1]);
    expect(allocation).toEqual([4, 3, 3]);
    expect(allocation.reduce((sum, cents) => sum + cents, 0)).toBe(10);
  });

  it("breaks equal remainders by earlier index", () => {
    expect(allocateAcrossLines(1, [1, 1])).toEqual([1, 0]);
  });

  it("allocates negative totals symmetrically", () => {
    expect(allocateAcrossLines(-10, [1, 1, 1])).toEqual([-4, -3, -3]);
  });

  it("leaves zero-weight lines at zero", () => {
    expect(allocateAcrossLines(9, [0, 2, 1])).toEqual([0, 6, 3]);
  });

  it("handles a zero total even when every weight is zero", () => {
    expect(allocateAcrossLines(0, [0, 0])).toEqual([0, 0]);
  });

  it("rejects impossible or invalid allocations", () => {
    expect(() => allocateAcrossLines(1, [0, 0])).toThrow(
      "every weight is zero",
    );
    expect(() => allocateAcrossLines(1, [1, -1])).toThrow(
      "Weights cannot be negative",
    );
    expect(() => allocateAcrossLines(1, [])).toThrow(
      "without any lines",
    );
  });
});
