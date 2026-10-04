import { describe, expect, it } from "vitest";
import {
  RECOMMENDED_PICKUP_BILLING,
  calculateLateDeliveryCredit,
  calculateLateReturnCharge,
  calculateNeverDeliveredCredit,
  periodsBilledThrough,
  itemMonthlyPriceCents,
  lastChargeableDayKey,
  pickupBillingSettingsFrom,
  billingPeriodContaining,
  type PickupBillingSettings,
} from "@/domains/billing/pickup-billing";
import { appliedBalanceCreditCents, creditLinesForAppliedBalance } from "@/domains/billing/applied-credit-lines";
import { businessDateFromKey, businessDateEnd } from "@/lib/business-date";

// Pickup and delivery billing rules (owner decisions IN-24 / IN-26 / IN-27,
// 2026-10-03). Pure functions; every date is a Colorado calendar date.

const settings: PickupBillingSettings = { ...RECOMMENDED_PICKUP_BILLING };
const day = (key: string) => businessDateFromKey(key)!;
/** The last second of a Colorado date — what an agreement's endDate holds for a fixed term. */
const endOfDay = (key: string) => businessDateEnd(key);
/** A pickup recorded at 3:30 pm Colorado time on that date. */
const afternoon = (key: string) => new Date(day(key).getTime() + 15.5 * 3_600_000);

describe("late return (rule 1)", () => {
  it("charges 3 late days at the monthly price ÷ 30 when picked up 4 days after the end date (pickup day not billed)", () => {
    // Agreement ends Oct 10 (last paid day). Picked up Oct 14 → late days are Oct 11, 12, 13.
    const charge = calculateLateReturnCharge({
      itemLabel: "Washer #W-101",
      itemMonthlyPriceCents: 4_500,
      agreedEndDate: endOfDay("2026-10-10"),
      pickupDate: afternoon("2026-10-14"),
      settings,
    });
    expect(charge.days).toBe(3);
    expect(charge.dailyRateCents).toBe(150);
    expect(charge.amountCents).toBe(450);
    expect(charge.description).toBe("Late return – Washer #W-101 – 3 days");
    expect(charge.firstChargedDayKey).toBe("2026-10-11");
    expect(charge.lastChargedDayKey).toBe("2026-10-13");
  });

  it("charges the pickup day too when the owner turns that switch off", () => {
    const charge = calculateLateReturnCharge({
      itemLabel: "Washer #W-101",
      itemMonthlyPriceCents: 4_500,
      agreedEndDate: endOfDay("2026-10-10"),
      pickupDate: afternoon("2026-10-14"),
      settings: { ...settings, pickupDayNotBilled: false },
    });
    expect(charge.days).toBe(4);
    expect(charge.amountCents).toBe(600);
    expect(charge.description).toBe("Late return – Washer #W-101 – 4 days");
  });

  it("uses the owner's fixed daily amount when that mode is chosen", () => {
    const charge = calculateLateReturnCharge({
      itemLabel: "Dryer #D-7",
      itemMonthlyPriceCents: 4_500,
      agreedEndDate: endOfDay("2026-10-10"),
      pickupDate: afternoon("2026-10-14"),
      settings: { ...settings, lateReturnRateMode: "FIXED", lateReturnFixedDailyCents: 500 },
    });
    expect(charge.days).toBe(3);
    expect(charge.dailyRateCents).toBe(500);
    expect(charge.amountCents).toBe(1_500);
    expect(charge.basis).toContain("$5");
  });

  it("rounds the total once, not per day, so cents never drift", () => {
    // $35 ÷ 30 = $1.1666… per day. 3 days = $3.50 exactly, not 3 × $1.17 = $3.51.
    const charge = calculateLateReturnCharge({
      itemLabel: "Fridge #F-2",
      itemMonthlyPriceCents: 3_500,
      agreedEndDate: endOfDay("2026-10-10"),
      pickupDate: afternoon("2026-10-14"),
      settings,
    });
    expect(charge.amountCents).toBe(350);
  });

  it("charges nothing for a pickup on the day after the end date (that day is the pickup day)", () => {
    const charge = calculateLateReturnCharge({
      itemLabel: "Washer #W-101",
      itemMonthlyPriceCents: 4_500,
      agreedEndDate: endOfDay("2026-10-10"),
      pickupDate: afternoon("2026-10-11"),
      settings,
    });
    expect(charge.days).toBe(0);
    expect(charge.amountCents).toBe(0);
  });

  it("charges nothing for a pickup on or before the end date", () => {
    for (const key of ["2026-10-10", "2026-10-03"]) {
      const charge = calculateLateReturnCharge({
        itemLabel: "Washer #W-101",
        itemMonthlyPriceCents: 4_500,
        agreedEndDate: endOfDay("2026-10-10"),
        pickupDate: afternoon(key),
        settings,
      });
      expect(charge.days).toBe(0);
      expect(charge.amountCents).toBe(0);
    }
  });

  it("counts a late return across the fall daylight-saving change as whole calendar days", () => {
    // Clocks fall back Nov 1, 2026. End Oct 30, pickup Nov 3 → Oct 31, Nov 1, Nov 2 = 3 days.
    const charge = calculateLateReturnCharge({
      itemLabel: "Washer #W-101",
      itemMonthlyPriceCents: 3_000,
      agreedEndDate: endOfDay("2026-10-30"),
      pickupDate: afternoon("2026-11-03"),
      settings,
    });
    expect(charge.days).toBe(3);
    expect(charge.amountCents).toBe(300);
  });
});

describe("late delivery on a 2-item agreement (rule 2)", () => {
  // Washer + dryer set: one rental line at $60/month, two appliances. The
  // washer arrives Oct 1 and billing for the WHOLE agreement starts that day
  // (period Oct 1 – Oct 31). The dryer only arrives Oct 11: it was missing
  // Oct 1 … Oct 10 = 10 days.
  const period = { start: day("2026-10-01"), end: day("2026-11-01") };

  it("splits a set's price evenly per item", () => {
    expect(itemMonthlyPriceCents(6_000, 2, 0)).toBe(3_000);
    expect(itemMonthlyPriceCents(6_000, 2, 1)).toBe(3_000);
    // An odd cent lands on the first item so the parts still add up to the line.
    expect(itemMonthlyPriceCents(6_001, 2, 0) + itemMonthlyPriceCents(6_001, 2, 1)).toBe(6_001);
    expect(itemMonthlyPriceCents(4_500, 1)).toBe(4_500);
  });

  it("credits the late item 10 days at its monthly share ÷ 30; the item that arrived on time gets nothing", () => {
    const dryer = calculateLateDeliveryCredit({
      itemLabel: "Dryer #D-7",
      itemMonthlyPriceCents: itemMonthlyPriceCents(6_000, 2, 1),
      originalDeliveryDate: day("2026-10-01"),
      actualDeliveryDate: afternoon("2026-10-11"),
      period,
      maxCreditCents: 3_000,
      settings,
    });
    expect(dryer.days).toBe(10);
    expect(dryer.periodDays).toBe(31);
    expect(dryer.dailyRateCents).toBe(100);
    expect(dryer.amountCents).toBe(1_000);
    expect(dryer.description).toBe("Credit – Dryer #D-7 delivered late – 10 days");
    expect(dryer.firstCreditedDayKey).toBe("2026-10-01");
    expect(dryer.lastCreditedDayKey).toBe("2026-10-10");
  });

  it("splits a delay that crosses a billing month and divides each piece by that month's own length", () => {
    // $30 item missing Jan 1 through Feb 28 (arrives Mar 1); billing anniversary is the 1st.
    const credit = calculateLateDeliveryCredit({
      itemLabel: "Dryer #D-7",
      itemMonthlyPriceCents: 3_000,
      originalDeliveryDate: day("2027-01-01"),
      actualDeliveryDate: day("2027-03-01"),
      period: { start: day("2027-01-01"), end: day("2027-02-01") },
      billingAnchor: day("2027-01-01"),
      maxCreditCents: 6_000,
      settings: { ...settings, lateDeliveryProrationBasis: "ACTUAL_DAYS_IN_MONTH" },
    });
    expect(credit.days).toBe(59);
    expect(credit.amountCents).toBe(6_000); // one full 31-day month + one full 28-day month = 2 × $30
  });

  it("uses the real length of the billing month when the owner picks that basis", () => {
    const dryer = calculateLateDeliveryCredit({
      itemLabel: "Dryer #D-7",
      itemMonthlyPriceCents: 3_000,
      originalDeliveryDate: day("2026-10-01"),
      actualDeliveryDate: afternoon("2026-10-11"),
      period,
      maxCreditCents: 3_000,
      settings: { ...settings, lateDeliveryProrationBasis: "ACTUAL_DAYS_IN_MONTH" },
    });
    expect(dryer.days).toBe(10);
    // $30 × 10 ÷ 31 = $9.677… → $9.68
    expect(dryer.amountCents).toBe(968);
    expect(dryer.basis).toContain("31 days");
  });

  it("rounds the total once, not per day", () => {
    // $35 ÷ 30 = $1.1666… per day; 3 days = $3.50, not 3 × $1.17 = $3.51.
    const credit = calculateLateDeliveryCredit({
      itemLabel: "Fridge #F-2",
      itemMonthlyPriceCents: 3_500,
      originalDeliveryDate: day("2026-10-01"),
      actualDeliveryDate: afternoon("2026-10-04"),
      period,
      maxCreditCents: 3_500,
      settings,
    });
    expect(credit.amountCents).toBe(350);
  });

  it("never credits more than was billed for the item", () => {
    // 40 days late with ÷ 30 would be $40 of a $30 item; only one month was billed.
    const credit = calculateLateDeliveryCredit({
      itemLabel: "Dryer #D-7",
      itemMonthlyPriceCents: 3_000,
      originalDeliveryDate: day("2026-10-01"),
      actualDeliveryDate: afternoon("2026-11-10"),
      period,
      maxCreditCents: 3_000,
      settings,
    });
    expect(credit.days).toBe(40);
    expect(credit.amountCents).toBe(3_000);
  });

  it("credits nothing when the item arrives on the original date after all", () => {
    const none = calculateLateDeliveryCredit({
      itemLabel: "Dryer #D-7",
      itemMonthlyPriceCents: 3_000,
      originalDeliveryDate: day("2026-10-01"),
      actualDeliveryDate: afternoon("2026-10-01"),
      period,
      maxCreditCents: 3_000,
      settings,
    });
    expect(none.days).toBe(0);
    expect(none.amountCents).toBe(0);
  });

  it("an item never delivered and taken off the agreement is credited every month billed for it", () => {
    const anchor = afternoon("2026-10-01");
    expect(periodsBilledThrough(anchor, afternoon("2026-10-20"))).toBe(1);
    expect(periodsBilledThrough(anchor, afternoon("2026-11-01"))).toBe(2);
    expect(periodsBilledThrough(anchor, afternoon("2026-09-30"))).toBe(0);
    const credit = calculateNeverDeliveredCredit({ itemLabel: "Dryer #D-7", itemMonthlyPriceCents: 3_000, periodsBilled: 2 });
    expect(credit.amountCents).toBe(6_000);
    expect(credit.description).toBe("Credit – Dryer #D-7 never delivered – 2 months billed");
  });
});

describe("pickup on the 1st of the month (rule 3)", () => {
  it("does not charge the 1st: an agreement ending Sep 30 picked up Oct 1 has no late days", () => {
    const charge = calculateLateReturnCharge({
      itemLabel: "Washer #W-101",
      itemMonthlyPriceCents: 4_500,
      agreedEndDate: endOfDay("2026-09-30"),
      pickupDate: afternoon("2026-10-01"),
      settings,
    });
    expect(charge.days).toBe(0);
    expect(charge.amountCents).toBe(0);
    expect(lastChargeableDayKey(afternoon("2026-10-01"), settings)).toBe("2026-09-30");
  });

  it("an item delivered on the 1st when billing started the 1st is not late at all", () => {
    const credit = calculateLateDeliveryCredit({
      itemLabel: "Washer #W-101",
      itemMonthlyPriceCents: 4_500,
      originalDeliveryDate: day("2026-10-01"),
      actualDeliveryDate: afternoon("2026-10-01"),
      period: { start: day("2026-10-01"), end: day("2026-11-01") },
      maxCreditCents: 4_500,
      settings,
    });
    expect(credit.days).toBe(0);
    expect(credit.amountCents).toBe(0);
  });

  it("charges the 1st only when the owner turns the switch off", () => {
    expect(lastChargeableDayKey(afternoon("2026-10-01"), { pickupDayNotBilled: false })).toBe("2026-10-01");
    const charge = calculateLateReturnCharge({
      itemLabel: "Washer #W-101",
      itemMonthlyPriceCents: 4_500,
      agreedEndDate: endOfDay("2026-09-30"),
      pickupDate: afternoon("2026-10-01"),
      settings: { ...settings, pickupDayNotBilled: false },
    });
    expect(charge.days).toBe(1);
    expect(charge.amountCents).toBe(150);
  });

  it("treats a pickup late at night in Colorado as that Colorado date, not the next UTC date", () => {
    // 11:30 pm Sep 30 Colorado = 05:30 Oct 1 UTC. The pickup is on Sep 30: the 30th is the pickup day.
    const lateNight = new Date(day("2026-09-30").getTime() + 23.5 * 3_600_000);
    expect(lastChargeableDayKey(lateNight, settings)).toBe("2026-09-29");
  });
});

describe("billing period that contains a date", () => {
  it("finds the anniversary period around the return date", () => {
    const anchor = afternoon("2026-03-08");
    expect(billingPeriodContaining(anchor, afternoon("2026-10-22"))).toMatchObject({
      start: day("2026-10-08"),
      end: day("2026-11-08"),
      index: 7,
    });
    expect(billingPeriodContaining(anchor, afternoon("2026-10-07"))).toMatchObject({
      start: day("2026-09-08"),
      end: day("2026-10-08"),
      index: 6,
    });
    expect(billingPeriodContaining(anchor, afternoon("2026-10-08"))).toMatchObject({
      start: day("2026-10-08"),
      index: 7,
    });
  });

  it("never goes before the first period", () => {
    const anchor = afternoon("2026-10-08");
    expect(billingPeriodContaining(anchor, afternoon("2026-10-01")).index).toBe(0);
  });
});

describe("settings", () => {
  it("falls back to the recommended values for anything unknown", () => {
    expect(pickupBillingSettingsFrom({})).toEqual(RECOMMENDED_PICKUP_BILLING);
    expect(
      pickupBillingSettingsFrom({
        lateReturnRateMode: "SOMETHING_ELSE",
        lateReturnFixedDailyCents: -5,
        lateDeliveryProrationBasis: null,
        pickupDayNotBilled: null,
      }),
    ).toEqual(RECOMMENDED_PICKUP_BILLING);
  });

  it("keeps the owner's saved choices", () => {
    expect(
      pickupBillingSettingsFrom({
        lateReturnRateMode: "FIXED",
        lateReturnFixedDailyCents: 250,
        lateDeliveryProrationBasis: "ACTUAL_DAYS_IN_MONTH",
        pickupDayNotBilled: false,
      }),
    ).toEqual({
      lateReturnRateMode: "FIXED",
      lateReturnFixedDailyCents: 250,
      lateDeliveryProrationBasis: "ACTUAL_DAYS_IN_MONTH",
      pickupDayNotBilled: false,
    });
  });
});

describe("credit shown on the next bill", () => {
  it("reads the credit Stripe applied from the balance move", () => {
    expect(appliedBalanceCreditCents({ starting_balance: -1_000, ending_balance: 0 })).toBe(1_000);
    expect(appliedBalanceCreditCents({ starting_balance: -1_000, ending_balance: -400 })).toBe(600);
    expect(appliedBalanceCreditCents({ starting_balance: 0, ending_balance: 0 })).toBe(0);
    expect(appliedBalanceCreditCents({ starting_balance: 500, ending_balance: 0 })).toBe(0);
    expect(appliedBalanceCreditCents({ starting_balance: -1_000, ending_balance: null })).toBe(0);
  });

  it("labels each credit with its own reason, oldest first, and never more than Stripe applied", () => {
    const { lines, shown } = creditLinesForAppliedBalance(1_300, [
      { id: "c1", amountCents: 1_000, shownCents: 0, reason: "Credit – Dryer #D-7 delivered late – 10 days" },
      { id: "c2", amountCents: 500, shownCents: 0, reason: "Credit – Washer #W-1 delivered late – 5 days" },
    ]);
    expect(lines).toEqual([
      { kind: "CREDIT", description: "Credit – Dryer #D-7 delivered late – 10 days", amountCents: -1_000, rentalLineId: null },
      { kind: "CREDIT", description: "Credit – Washer #W-1 delivered late – 5 days", amountCents: -300, rentalLineId: null },
    ]);
    expect(shown).toEqual([
      { id: "c1", cents: 1_000, complete: true },
      { id: "c2", cents: 300, complete: false },
    ]);
  });

  it("shows only the unshown part of a credit Stripe split across two bills, and completes it on the second", () => {
    const { lines, shown } = creditLinesForAppliedBalance(200, [
      { id: "c2", amountCents: 500, shownCents: 300, reason: "Credit – Washer #W-1 delivered late – 5 days" },
    ]);
    expect(lines).toEqual([{ kind: "CREDIT", description: "Credit – Washer #W-1 delivered late – 5 days", amountCents: -200, rentalLineId: null }]);
    expect(shown).toEqual([{ id: "c2", cents: 200, complete: true }]);
  });

  it("still shows credit it cannot match to a record (an old credit is not relabeled)", () => {
    const { lines, shown } = creditLinesForAppliedBalance(700, []);
    expect(lines).toEqual([{ kind: "CREDIT", description: "Account credit applied", amountCents: -700, rentalLineId: null }]);
    expect(shown).toEqual([]);
  });
});
