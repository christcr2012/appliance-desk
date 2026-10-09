import { describe, expect, it } from "vitest";
import {
  RECOMMENDED_PICKUP_BILLING_FORM,
  pickupBillingDefaults,
  pickupBillingUpdate,
} from "@/domains/settings/pickup-billing";
import { RECOMMENDED_PICKUP_BILLING } from "@/domains/billing/pickup-billing";
import { itemNotDeliveredException } from "@/domains/exceptions/rules";

// The "Pickups and deliveries" settings section: what the owner types is checked
// and converted here before it is saved.

describe("pickupBillingUpdate", () => {
  const base = {
    lateReturnRateMode: "MONTHLY_DIV_30",
    lateReturnFixedDailyDollars: "",
    lateDeliveryProrationBasis: "MONTHLY_DIV_30",
    pickupDayNotBilled: true,
  };

  it("saves the recommended values as stored settings", () => {
    expect(pickupBillingUpdate(base)).toEqual({
      success: true,
      update: {
        lateReturnRateMode: "MONTHLY_DIV_30",
        lateReturnFixedDailyCents: 0,
        lateDeliveryProrationBasis: "MONTHLY_DIV_30",
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
        lateDeliveryProrationBasis: "MONTHLY_DIV_30",
        pickupDayNotBilled: true,
      },
    });
  });

  it("refuses a fixed rate of nothing, a bad amount, or an unknown choice", () => {
    expect(pickupBillingUpdate({ ...base, lateReturnRateMode: "FIXED" })).toMatchObject({ success: false });
    expect(pickupBillingUpdate({ ...base, lateReturnFixedDailyDollars: "two bucks" })).toMatchObject({ success: false });
    expect(pickupBillingUpdate({ ...base, lateReturnRateMode: "DOUBLE" })).toMatchObject({ success: false });
    expect(pickupBillingUpdate({ ...base, lateDeliveryProrationBasis: "" })).toMatchObject({ success: false });
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
      lateDeliveryProrationBasis: "MONTHLY_DIV_30",
      pickupDayNotBilled: true,
      outOfServiceEscalationDays: "3",
    });
  });

  it("checks the out-for-repair urgency days (W-21A) and leaves them alone when an older form omits them", () => {
    const base = { ...RECOMMENDED_PICKUP_BILLING_FORM };
    expect(pickupBillingUpdate({ ...base, outOfServiceEscalationDays: "5" })).toMatchObject({ success: true, update: { outOfServiceEscalationDays: 5 } });
    expect(pickupBillingUpdate({ ...base, outOfServiceEscalationDays: "0" })).toMatchObject({ success: false });
    expect(pickupBillingUpdate({ ...base, outOfServiceEscalationDays: "2.5" })).toMatchObject({ success: false });
    const { outOfServiceEscalationDays: _omit, ...older } = base;
    void _omit;
    const result = pickupBillingUpdate(older);
    expect(result.success && "outOfServiceEscalationDays" in result.update).toBe(false);
  });

  it("shows a saved fixed rate in dollars", () => {
    expect(
      pickupBillingDefaults({ ...RECOMMENDED_PICKUP_BILLING, lateReturnRateMode: "FIXED", lateReturnFixedDailyCents: 250 }),
    ).toMatchObject({ lateReturnRateMode: "FIXED", lateReturnFixedDailyDollars: "2.50" });
  });
});

describe("item not delivered yet", () => {
  it("points staff at the delivery visit and says what still has to happen", () => {
    const item = itemNotDeliveredException({
      originalJobId: "job-1",
      itemLabel: "Dryer #D1",
      originalDeliveryDate: new Date("2026-10-01T06:00:00Z"),
      customerName: "Pat Example",
    });
    expect(item.category).toBe("ITEM_NOT_DELIVERED");
    expect(item.severity).toBe("high");
    expect(item.href).toBe("/desk/jobs/job-1");
    expect(item.title).toContain("Dryer #D1");
    expect(item.detail).toMatch(/Schedule a delivery job/);
  });
});
