import { describe, it, expect } from "vitest";
import { resolveConversionAddresses, totalMonthlyCents, totalOneTimeCents } from "@/domains/estimates";

// resolveConversionAddresses/totalMonthlyCents/totalOneTimeCents are
// pure — no database access, directly unit-testable — same reasoning
// as canTransitionAgreementStatus in tests/agreements.test.ts. The rest
// of src/domains/estimates needs a real database and is exercised by
// CI's real-Postgres run instead.

describe("resolveConversionAddresses", () => {
  const lineItems = [
    { description: "Unit 1A washer/dryer", serviceAddressId: "addr-1" },
    { description: "Unit 1B washer/dryer", serviceAddressId: "addr-1" },
    { description: "Unit 2A washer/dryer", serviceAddressId: "addr-2" },
  ];

  it("single mode always resolves to just the one given address, regardless of the line items", () => {
    expect(resolveConversionAddresses(lineItems, { mode: "single", serviceAddressId: "addr-9" })).toEqual([
      "addr-9",
    ]);
  });

  it("single mode works even with no line items tied to any property", () => {
    const noAddress = [{ description: "Bulk mobilization fee", serviceAddressId: null }];
    expect(resolveConversionAddresses(noAddress, { mode: "single", serviceAddressId: "addr-9" })).toEqual([
      "addr-9",
    ]);
  });

  it("per-property mode groups into one entry per distinct address", () => {
    const result = resolveConversionAddresses(lineItems, { mode: "per-property" });
    expect(result.sort()).toEqual(["addr-1", "addr-2"]);
  });

  it("per-property mode throws if any line item has no property assigned, naming that line", () => {
    const withUnassigned = [...lineItems, { description: "Bulk mobilization fee", serviceAddressId: null }];
    expect(() => resolveConversionAddresses(withUnassigned, { mode: "per-property" })).toThrow(
      /Bulk mobilization fee.*isn't tied to a property/,
    );
  });
});

describe("totalMonthlyCents / totalOneTimeCents", () => {
  it("multiplies each line's per-unit price by its quantity and sums across lines", () => {
    const lineItems = [
      { monthlyPriceCents: 5000, oneTimeFeeCents: 0, quantity: 3 },
      { monthlyPriceCents: 4000, oneTimeFeeCents: 15000, quantity: 1 },
    ];
    expect(totalMonthlyCents(lineItems)).toBe(5000 * 3 + 4000 * 1);
    expect(totalOneTimeCents(lineItems)).toBe(0 * 3 + 15000 * 1);
  });

  it("returns 0 for no line items", () => {
    expect(totalMonthlyCents([])).toBe(0);
    expect(totalOneTimeCents([])).toBe(0);
  });
});
