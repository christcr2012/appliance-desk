import { describe, expect, it } from "vitest";
import { endOptions, type EndOptionsInput } from "@/domains/agreements/end-options";

// AR-4a / RENTALS spec section 5: every option's condition.
function input(
  patch: Partial<EndOptionsInput["agreement"]> = {},
  extras: Partial<EndOptionsInput> = {},
): EndOptionsInput {
  return {
    agreement: {
      id: "agr-1",
      status: "ACTIVE",
      termMonths: 12,
      endDate: new Date("2027-10-01T00:00:00Z"),
      terminationRequestedAt: null,
      firstDeliveredOn: new Date("2026-10-05T00:00:00Z"),
      customerName: "Alice",
      ...patch,
    },
    monthToMonthEndAvailable: false,
    returnPickupFound: false,
    ...extras,
  };
}

const keys = (i: EndOptionsInput) => endOptions(i).map((o) => o.key);

describe("endOptions", () => {
  it("a fixed-term active rental sees the term ending and end today", () => {
    expect(keys(input())).toEqual(["term-ending", "end-today"]);
  });

  it("termination already requested hides the term-ending option", () => {
    expect(keys(input({ terminationRequestedAt: new Date() }))).toEqual(["end-today"]);
  });

  it("month-to-month needs the end quote to offer stopping", () => {
    const base = { termMonths: null, endDate: null };
    expect(keys(input(base))).toEqual(["end-today"]);
    expect(keys(input(base, { monthToMonthEndAvailable: true }))).toEqual([
      "month-to-month",
      "end-today",
    ]);
  });

  it("early return needs delivery and a found pickup", () => {
    expect(keys(input({}, { returnPickupFound: true }))).toEqual([
      "term-ending",
      "early-return",
      "end-today",
    ]);
    expect(keys(input({ firstDeliveredOn: null }, { returnPickupFound: true }))).toEqual([
      "term-ending",
      "cancel-before-delivery",
      "end-today",
    ]);
  });

  it("an undelivered draft only offers cancel before delivery", () => {
    expect(
      keys(input({ status: "DRAFT", firstDeliveredOn: null, termMonths: null, endDate: null })),
    ).toEqual(["cancel-before-delivery"]);
  });

  it("ended and cancelled rentals get no options", () => {
    expect(endOptions(input({ status: "ENDED" }))).toEqual([]);
    expect(endOptions(input({ status: "CANCELLED" }))).toEqual([]);
  });

  it("end today carries the danger confirmation words", () => {
    const option = endOptions(input()).find((o) => o.key === "end-today");
    expect(option?.confirm?.title).toBe("End Alice's rental today?");
    expect(option?.confirm?.confirmLabel).toBe("End the rental");
    expect(option?.confirm?.summary).toContain("This can't be undone.");
  });
});
