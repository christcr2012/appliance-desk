import { describe, expect, it } from "vitest";
import {
  RECOMMENDED_PICKUP_BILLING_FORM,
  pickupBillingDefaults,
  pickupBillingUpdate,
} from "@/domains/settings/pickup-billing";
import { RECOMMENDED_PICKUP_BILLING } from "@/domains/billing/pickup-billing";
import { returnedItemStillBilledException } from "@/domains/exceptions/rules";

// The "Pickups and returns" settings section: what the owner types is checked
// and converted here before it is saved.

describe("pickupBillingUpdate", () => {
  const base = {
    lateReturnRateMode: "MONTHLY_DIV_30",
    lateReturnFixedDailyDollars: "",
    earlyReturnProrationBasis: "MONTHLY_DIV_30",
    pickupDayNotBilled: true,
  };

  it("saves the recommended values as stored settings", () => {
    expect(pickupBillingUpdate(base)).toEqual({
      success: true,
      update: {
        lateReturnRateMode: "MONTHLY_DIV_30",
        lateReturnFixedDailyCents: 0,
        earlyReturnProrationBasis: "MONTHLY_DIV_30",
        pickupDayNotBilled: true,
      },
    });
  });

  it("converts a fixed daily dollar amount to cents", () => {
    const result = pickupBillingUpdate({ ...base, lateReturnRateMode: "FIXED", lateReturnFixedDailyDollars: "$2.50" });
    expect(result).toEqual({
      success: true,
      update: {
        lateReturnRateMode: "FIXED",
        lateReturnFixedDailyCents: 250,
        earlyReturnProrationBasis: "MONTHLY_DIV_30",
        pickupDayNotBilled: true,
      },
    });
  });

  it("refuses a fixed rate of nothing, a bad amount, or an unknown choice", () => {
    expect(pickupBillingUpdate({ ...base, lateReturnRateMode: "FIXED" })).toMatchObject({ success: false });
    expect(pickupBillingUpdate({ ...base, lateReturnFixedDailyDollars: "two bucks" })).toMatchObject({ success: false });
    expect(pickupBillingUpdate({ ...base, lateReturnRateMode: "DOUBLE" })).toMatchObject({ success: false });
    expect(pickupBillingUpdate({ ...base, earlyReturnProrationBasis: "" })).toMatchObject({ success: false });
    expect(pickupBillingUpdate({ ...base, pickupDayNotBilled: "yes" })).toMatchObject({ success: false });
    expect(pickupBillingUpdate({})).toMatchObject({ success: false });
  });

  it("keeps a typed fixed amount even while ÷ 30 is selected, so switching later is painless", () => {
    const result = pickupBillingUpdate({ ...base, lateReturnFixedDailyDollars: "5" });
    expect(result).toMatchObject({ success: true, update: { lateReturnFixedDailyCents: 500 } });
  });
});

describe("form defaults", () => {
  it("round-trips the recommended values", () => {
    expect(pickupBillingDefaults(RECOMMENDED_PICKUP_BILLING)).toEqual(RECOMMENDED_PICKUP_BILLING_FORM);
    expect(RECOMMENDED_PICKUP_BILLING_FORM).toEqual({
      lateReturnRateMode: "MONTHLY_DIV_30",
      lateReturnFixedDailyDollars: "",
      earlyReturnProrationBasis: "MONTHLY_DIV_30",
      pickupDayNotBilled: true,
    });
  });

  it("shows a saved fixed rate in dollars", () => {
    expect(
      pickupBillingDefaults({ ...RECOMMENDED_PICKUP_BILLING, lateReturnRateMode: "FIXED", lateReturnFixedDailyCents: 250 }),
    ).toMatchObject({ lateReturnRateMode: "FIXED", lateReturnFixedDailyDollars: "2.50" });
  });
});

describe("returned item still on the monthly bill", () => {
  it("points the owner at the rental and says what still has to happen", () => {
    const item = returnedItemStillBilledException({
      agreementId: "agr-2",
      itemLabel: "Dryer #D1",
      returnedAt: new Date("2026-10-22T21:30:00Z"),
      customerName: "Pat Example",
    });
    expect(item.category).toBe("RETURNED_ITEM_STILL_BILLED");
    expect(item.severity).toBe("high");
    expect(item.href).toBe("/desk/agreements/agr-2");
    expect(item.title).toContain("Dryer #D1");
    expect(item.detail).toMatch(/still includes this appliance/);
  });
});
