import { describe, it, expect } from "vitest";
import {
  computeAgreementEarnings,
  computeEstimatedEarningsCents,
  rentShareOfPaidCents,
} from "@/domains/reports/earnings";
import { businessDateFromKey, businessEndOfDay } from "@/lib/business-date";

// Actual vs. estimated earnings (Task #45, /desk/reports) — see src/domains/reports/earnings.ts for what each side
// means. Dates are Colorado calendar days (America/Denver), because billing months are counted from the same Colorado
// day each month (BUSINESS-RULES: anniversary billing).
const day = (key: string) => businessDateFromKey(key)!;
const line = (monthlyPriceCents: number) => ({ monthlyPriceCents });
const base = { endDate: null, closedAt: null, lines: [line(6000)] };

describe("computeEstimatedEarningsCents", () => {
  it("is $0 for an agreement that never started billing", () => {
    expect(
      computeEstimatedEarningsCents({ billingStartedAt: null, ...base }, day("2026-09-28")),
    ).toBe(0);
  });

  it("charges a whole month for each completed billing month, whatever its length", () => {
    // Sep 1 to Oct 1 is 30 days, Oct 1 to Nov 1 is 31 days, Feb is 28: each is exactly one month.
    expect(computeEstimatedEarningsCents({ billingStartedAt: day("2026-09-01"), ...base }, day("2026-10-01"))).toBe(6000);
    expect(computeEstimatedEarningsCents({ billingStartedAt: day("2026-10-01"), ...base }, day("2026-11-01"))).toBe(6000);
    expect(computeEstimatedEarningsCents({ billingStartedAt: day("2027-02-01"), ...base }, day("2027-03-01"))).toBe(6000);
    expect(computeEstimatedEarningsCents({ billingStartedAt: day("2026-09-01"), ...base }, day("2026-12-01"))).toBe(18000);
  });

  it("adds the share of the current month that has passed", () => {
    // 15 of the 30 days of the Sep 1 to Oct 1 month; 31 days make Oct 1 to Nov 1 a 31-day month, so 15.5 days is half.
    expect(computeEstimatedEarningsCents({ billingStartedAt: day("2026-09-01"), ...base }, day("2026-09-16"))).toBe(3000);
    expect(computeEstimatedEarningsCents({ billingStartedAt: day("2026-09-01"), ...base }, day("2026-10-16"))).toBe(6000 + 2903);
  });

  it("keeps a month-end start on the last day of shorter months instead of drifting", () => {
    // Billing starts Jan 31: month 1 ends Feb 28, month 2 ends Mar 31.
    const a = { billingStartedAt: day("2027-01-31"), ...base };
    expect(computeEstimatedEarningsCents(a, day("2027-02-28"))).toBe(6000);
    expect(computeEstimatedEarningsCents(a, day("2027-03-31"))).toBe(12000);
    expect(computeEstimatedEarningsCents(a, day("2027-03-30"))).toBeLessThan(12000);
  });

  it("sums multiple lines before counting months", () => {
    const cents = computeEstimatedEarningsCents(
      { billingStartedAt: day("2026-09-01"), endDate: null, closedAt: null, lines: [line(6000), line(4000)] },
      day("2026-10-01"),
    );
    expect(cents).toBe(10000);
  });

  it("stops at the agreement's end date once it has ended (end of its last day is a whole month)", () => {
    const cents = computeEstimatedEarningsCents(
      { billingStartedAt: day("2026-08-01"), endDate: businessEndOfDay(day("2026-08-31")), closedAt: null, lines: [line(6000)] },
      day("2026-09-28"),
    );
    expect(cents).toBe(6000);
  });

  it("stops at closedAt for a cancelled month-to-month rental", () => {
    const closedAt = day("2026-09-16");
    const agreement = { billingStartedAt: day("2026-09-01"), endDate: null, closedAt, lines: [line(6000)] };
    expect(computeEstimatedEarningsCents(agreement, closedAt)).toBe(3000);
    expect(computeEstimatedEarningsCents(agreement, day("2026-10-16"))).toBe(3000);
  });

  it("uses the earliest of endDate and closedAt", () => {
    const cents = computeEstimatedEarningsCents(
      { billingStartedAt: day("2026-09-01"), endDate: day("2026-09-11"), closedAt: day("2026-09-20"), lines: [line(6000)] },
      day("2026-10-01"),
    );
    expect(cents).toBe(2000);
  });

  it("never goes negative for a nonsensical date range", () => {
    const cents = computeEstimatedEarningsCents(
      { billingStartedAt: day("2026-09-28"), endDate: day("2026-09-01"), closedAt: null, lines: [line(6000)] },
      day("2026-09-30"),
    );
    expect(cents).toBe(0);
  });

  it("counts a full month across the daylight-saving change", () => {
    // Colorado springs forward on 2027-03-14: Mar 1 to Apr 1 contains a 23-hour day and is still one month.
    expect(computeEstimatedEarningsCents({ billingStartedAt: day("2027-03-01"), ...base }, day("2027-04-01"))).toBe(6000);
  });
});

describe("rentShareOfPaidCents", () => {
  const rentOnly = { amountPaidCents: 6000, amountDueCents: 6000, lineItems: [{ kind: "RENTAL", amountCents: 6000 }], refundedCents: 0 };
  it("counts all of a paid rent-only invoice", () => {
    expect(rentShareOfPaidCents(rentOnly)).toBe(6000);
  });
  it("leaves out tax, fees and deposits paid on the same invoice", () => {
    // $60 rent + $5 tax + $35 deposit = $100 due, all paid: only the $60 is rent earned.
    expect(
      rentShareOfPaidCents({
        amountPaidCents: 10000,
        amountDueCents: 10000,
        lineItems: [
          { kind: "RENTAL", amountCents: 6000 },
          { kind: "TAX", amountCents: 500 },
          { kind: "DEPOSIT", amountCents: 3500 },
        ],
        refundedCents: 0,
      }),
    ).toBe(6000);
  });
  it("splits a part payment in proportion to the rent share", () => {
    expect(
      rentShareOfPaidCents({
        amountPaidCents: 5000,
        amountDueCents: 10000,
        lineItems: [{ kind: "RENTAL", amountCents: 6000 }, { kind: "DEPOSIT", amountCents: 4000 }],
        refundedCents: 0,
      }),
    ).toBe(3000);
  });
  it("takes refunds off before splitting, and never goes below zero", () => {
    expect(rentShareOfPaidCents({ ...rentOnly, refundedCents: 1500 })).toBe(4500);
    expect(rentShareOfPaidCents({ ...rentOnly, refundedCents: 9000 })).toBe(0);
  });
  it("counts the prepay discount and late-return rent as part of rent, and ignores shop sales", () => {
    expect(
      rentShareOfPaidCents({
        amountPaidCents: 5500,
        amountDueCents: 5500,
        lineItems: [
          { kind: "RENTAL", amountCents: 6000 },
          { kind: "PREPAY_DISCOUNT", amountCents: -1000 },
          { kind: "LATE_RETURN", amountCents: 500 },
        ],
        refundedCents: 0,
      }),
    ).toBe(5500);
    expect(
      rentShareOfPaidCents({ amountPaidCents: 2000, amountDueCents: 2000, lineItems: [{ kind: "MERCHANDISE", amountCents: 2000 }], refundedCents: 0 }),
    ).toBe(0);
  });
  it("is $0 for an invoice with nothing due", () => {
    expect(rentShareOfPaidCents({ amountPaidCents: 0, amountDueCents: 0, lineItems: [], refundedCents: 0 })).toBe(0);
  });
});

describe("computeAgreementEarnings", () => {
  it("reports a positive gap when collections are behind the agreed price", () => {
    const result = computeAgreementEarnings(
      { billingStartedAt: day("2026-09-01"), ...base, invoicePaidCents: 1000 },
      day("2026-10-01"),
    );
    expect(result.estimatedCents).toBe(6000);
    expect(result.actualCents).toBe(1000);
    expect(result.gapCents).toBe(5000);
  });

  it("reports a zero gap when collections match the estimate", () => {
    const result = computeAgreementEarnings(
      { billingStartedAt: day("2026-09-01"), ...base, invoicePaidCents: 6000 },
      day("2026-10-01"),
    );
    expect(result.gapCents).toBe(0);
  });
});
