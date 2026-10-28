import { describe, expect, it } from "vitest";
import {
  parseEndReasonInput,
  readEndReasonsValue,
  RECOMMENDED_END_REASONS,
} from "@/domains/agreements/end-reasons";

// AR-4a (RENTALS spec section 5): the why-it-ended capture is optional,
// list-bound, and the settings value falls back to the recommended list.
describe("rental end reasons", () => {
  it("falls back to the recommended list for junk settings values", () => {
    expect(readEndReasonsValue(null)).toEqual([...RECOMMENDED_END_REASONS]);
    expect(readEndReasonsValue("nope")).toEqual([...RECOMMENDED_END_REASONS]);
    expect(readEndReasonsValue([])).toEqual([...RECOMMENDED_END_REASONS]);
    expect(readEndReasonsValue([1, "", null])).toEqual([
      ...RECOMMENDED_END_REASONS,
    ]);
    expect(readEndReasonsValue(["Moved", "Price"])).toEqual(["Moved", "Price"]);
  });

  it("an empty answer means no reason recorded", () => {
    expect(parseEndReasonInput("", "", ["Price"])).toEqual({
      reason: null,
      note: null,
    });
    expect(parseEndReasonInput(null, null, ["Price"])).toEqual({
      reason: null,
      note: null,
    });
    // A note without a reason is not stored on its own.
    expect(parseEndReasonInput("", "some note", ["Price"])).toEqual({
      reason: null,
      note: null,
    });
  });

  it("accepts listed reasons and Other, trims and caps the note", () => {
    expect(parseEndReasonInput(" Price ", " too much ", ["Price"])).toEqual({
      reason: "Price",
      note: "too much",
    });
    const long = "x".repeat(500);
    const out = parseEndReasonInput("Other", long, ["Price"]);
    expect(out.reason).toBe("Other");
    expect(out.note).toHaveLength(200);
  });

  it("rejects a reason that is not on the owner's list", () => {
    expect(() => parseEndReasonInput("Invented", "", ["Price"])).toThrow(
      /Pick one of the reasons/,
    );
  });
});
