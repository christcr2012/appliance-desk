import { describe, expect, it } from "vitest";
import {
  rdfNewBusinessStartsOn,
  rdfRateForSale,
  retailDeliveryFeeStatus,
} from "@/domains/tax/retail-delivery-fee";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

const day = (value: string) => businessDateFromKey(value)!;
const input = {
  today: day("2026-10-08"),
  saleType: "RENTAL" as const,
  election: "COLLECT_ON_RENTALS" as const,
  previousYearRetailCents: 50000001,
  currentYearRetailCents: 0,
  thresholdCents: 50000000,
  thresholdCrossedOn: null,
  frequency: "MONTHLY" as const,
  handling: "PAY_MYSELF" as const,
  cpaConfirmedOn: day("2026-01-01"),
};

describe("T-6C1 Colorado retail-delivery-fee decision engine", () => {
  it("treats exact prior-year sales threshold as exempt and over as applicable", () => {
    expect(retailDeliveryFeeStatus({ ...input, previousYearRetailCents: 50000000 }).status)
      .toBe("EXEMPT_SMALL_BUSINESS");
    expect(retailDeliveryFeeStatus(input).status).toBe("APPLIES");
  });

  it("keeps delivered goods independent from the short-term rental election", () => {
    expect(retailDeliveryFeeStatus({ ...input, election: "PAY_ON_ACQUISITION" }).status)
      .toBe("NOT_APPLICABLE_LEASE_ELECTION");
    expect(retailDeliveryFeeStatus({
      ...input, saleType: "GOODS", election: "PAY_ON_ACQUISITION",
    }).status).toBe("APPLIES");
  });

  it("re-evaluates the annual exemption despite a persisted crossing date", () => {
    for (const previousYearRetailCents of [1, 50000000]) {
      const result = retailDeliveryFeeStatus({
        ...input, previousYearRetailCents, currentYearRetailCents: 60000000,
        thresholdCrossedOn: day("2025-01-15"),
      });
      expect(result.status).toBe("EXEMPT_SMALL_BUSINESS");
      expect(result.startsOn).toBeNull();
    }
    const applicable = retailDeliveryFeeStatus({
      ...input, thresholdCrossedOn: day("2026-10-01"),
    });
    expect(applicable.status).toBe("APPLIES");
    expect(businessDateKey(applicable.startsOn!)).toBe("2026-01-01");
  });

  it("ignores crossing evidence when sales no longer exceed the configured threshold", () => {
    for (const previousYearRetailCents of [0, 50000001]) {
      const result = retailDeliveryFeeStatus({
        ...input, previousYearRetailCents, currentYearRetailCents: 50000001,
        thresholdCents: 60000000, thresholdCrossedOn: day("2025-01-15"),
      });
      expect(result.status).toBe("EXEMPT_SMALL_BUSINESS");
      expect(result.startsOn).toBeNull();
    }
    expect(retailDeliveryFeeStatus({
      ...input, previousYearRetailCents: 0, currentYearRetailCents: 50000000,
      thresholdCrossedOn: day("2025-01-15"),
    }).status).toBe("EXEMPT_SMALL_BUSINESS");
  });

  it("starts a new business on the first filing period at least 90 days after crossing", () => {
    const crossing = day("2026-01-15");
    expect(businessDateKey(rdfNewBusinessStartsOn(crossing, "MONTHLY"))).toBe("2026-05-01");
    expect(businessDateKey(rdfNewBusinessStartsOn(crossing, "QUARTERLY"))).toBe("2026-07-01");
    expect(businessDateKey(rdfNewBusinessStartsOn(crossing, "ANNUAL"))).toBe("2027-01-01");
    const terms = {
      ...input, previousYearRetailCents: 0, currentYearRetailCents: 50000001,
      thresholdCrossedOn: crossing,
    };
    expect(retailDeliveryFeeStatus({ ...terms, today: day("2026-04-30") }).status)
      .toBe("EXEMPT_SMALL_BUSINESS");
    expect(retailDeliveryFeeStatus({ ...terms, today: day("2026-05-01") }).status)
      .toBe("APPLIES");
  });

  it("picks July effective fee without applying it to a June sale", () => {
    const rates = [
      { id: "old", effectiveOn: day("2026-01-01"), amountCents: 29 },
      { id: "new", effectiveOn: day("2026-07-01"), amountCents: 31 },
    ];
    expect(rdfRateForSale(day("2026-06-30"), rates)).toEqual({ id: "old", amountCents: 29 });
    expect(rdfRateForSale(day("2026-07-01"), rates)).toEqual({ id: "new", amountCents: 31 });
    expect(rdfRateForSale(day("2025-12-31"), rates)).toBeNull();
  });

  it("holds billing for missing handling, CPA evidence or threshold crossing", () => {
    expect(retailDeliveryFeeStatus({ ...input, handling: "UNDECIDED" }).status).toBe("UNDECIDED");
    expect(retailDeliveryFeeStatus({ ...input, cpaConfirmedOn: null }).status).toBe("UNDECIDED");
    expect(retailDeliveryFeeStatus({
      ...input, previousYearRetailCents: 0,
      currentYearRetailCents: 50000001, thresholdCrossedOn: null,
    }).status).toBe("UNDECIDED");
    expect(() => retailDeliveryFeeStatus({ ...input, thresholdCents: -1 })).toThrow(/nonnegative/);
  });
});
