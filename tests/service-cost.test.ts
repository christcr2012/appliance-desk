import { describe, expect, it } from "vitest";
import { priceExceedsCostLimit, typicalServiceCostCents } from "@/domains/orders/service-cost";

describe("FEETAX-1 typical service cost", () => {
  it("counts the round trip plus the visit time", () => {
    // 10 miles each way at 70 cents a mile + 60 minutes at 50 cents a minute.
    expect(typicalServiceCostCents({
      miles: 10, minutes: 60, truckCostPerMileCents: 70, laborCostPerMinuteCents: 50,
    })).toBe(20 * 70 + 60 * 50);
  });

  it("has no cost basis when any input is missing", () => {
    expect(typicalServiceCostCents({ miles: null, minutes: 60, truckCostPerMileCents: 70, laborCostPerMinuteCents: 50 })).toBeNull();
    expect(typicalServiceCostCents({ miles: 10, minutes: null, truckCostPerMileCents: 70, laborCostPerMinuteCents: 50 })).toBeNull();
    expect(typicalServiceCostCents({ miles: 10, minutes: 60, truckCostPerMileCents: null, laborCostPerMinuteCents: 50 })).toBeNull();
    expect(typicalServiceCostCents({ miles: 10, minutes: 60, truckCostPerMileCents: 70, laborCostPerMinuteCents: null })).toBeNull();
  });
});

describe("FEETAX-1 price-vs-cost warning", () => {
  it("warns only past the owner's limit over typical cost", () => {
    // Typical cost $40, limit 150%: warn above $60.
    expect(priceExceedsCostLimit({ priceCents: 6000, typicalCostCents: 4000, limitPercent: 150 })).toBe(false);
    expect(priceExceedsCostLimit({ priceCents: 6001, typicalCostCents: 4000, limitPercent: 150 })).toBe(true);
    expect(priceExceedsCostLimit({ priceCents: 4000, typicalCostCents: 4000, limitPercent: 150 })).toBe(false);
  });

  it("never warns without a cost basis", () => {
    expect(priceExceedsCostLimit({ priceCents: 999999, typicalCostCents: null, limitPercent: 150 })).toBe(false);
    expect(priceExceedsCostLimit({ priceCents: 999999, typicalCostCents: 0, limitPercent: 150 })).toBe(false);
  });
});
