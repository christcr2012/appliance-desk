import { describe, expect, it } from "vitest";
import { businessDateKey } from "@/lib/business-date";
import {
  stripeBillingCycleAnchorConfig,
  stripeBillingDateSeconds,
  stripeBillingDateSecondsAtProviderClock,
} from "@/domains/billing/stripe-billing-anchor";

function recurOneUtcMonth(anchorSeconds: number): Date {
  const next = new Date(anchorSeconds * 1000);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

describe("Stripe billing timestamps preserve the Colorado billing date", () => {
  it("stays on the intended Colorado date across the autumn DST fallback", () => {
    const october = stripeBillingDateSeconds(new Date("2026-10-01T06:00:00.000Z"));
    const november = recurOneUtcMonth(october);
    const december = recurOneUtcMonth(Math.floor(november.getTime() / 1000));

    expect(new Date(october * 1000).toISOString()).toBe("2026-10-01T07:00:00.000Z");
    expect(businessDateKey(new Date(october * 1000))).toBe("2026-10-01");
    expect(businessDateKey(november)).toBe("2026-11-01");
    expect(businessDateKey(december)).toBe("2026-12-01");
  });

  it("stays on the intended Colorado date across the spring DST transition", () => {
    const february = stripeBillingDateSeconds(new Date("2027-02-08T07:00:00.000Z"));
    const march = recurOneUtcMonth(february);
    const april = recurOneUtcMonth(Math.floor(march.getTime() / 1000));

    expect(new Date(february * 1000).toISOString()).toBe("2027-02-08T07:00:00.000Z");
    expect(businessDateKey(new Date(february * 1000))).toBe("2027-02-08");
    expect(businessDateKey(march)).toBe("2027-03-08");
    expect(businessDateKey(april)).toBe("2027-04-08");
  });

  it.each([29, 30, 31])("preserves an original delivery day of %i through short months", (day) => {
    expect(stripeBillingCycleAnchorConfig(new Date(`2026-01-${day}T07:00:00.000Z`))).toEqual({
      day_of_month: day,
      hour: 7,
      minute: 0,
      second: 0,
    });
  });

  it("uses a legacy subscription's actual UTC cycle clock for a later cancellation date", () => {
    const legacyAnchor = Math.floor(Date.parse("2026-10-08T06:00:00.000Z") / 1000);
    const targetColoradoDate = new Date("2027-03-08T07:00:00.000Z");

    expect(stripeBillingDateSecondsAtProviderClock(targetColoradoDate, legacyAnchor)).toBe(
      Math.floor(Date.parse("2027-03-08T06:00:00.000Z") / 1000),
    );
  });
});