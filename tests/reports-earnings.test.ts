import { describe, it, expect } from "vitest";
import { computeEstimatedEarningsCents, computeAgreementEarnings } from "@/domains/reports/earnings";

// Actual vs. estimated earnings (Task #45, /desk/reports) — see
// src/domains/reports/earnings.ts for what each side means.

describe("computeEstimatedEarningsCents", () => {
  it("is $0 for an agreement that never started billing", () => {
    const cents = computeEstimatedEarningsCents(
      { billingStartedAt: null, endDate: null, closedAt: null, lines: [{ monthlyPriceCents: 6000 }] },
      new Date("2026-09-28"),
    );
    expect(cents).toBe(0);
  });

  it("prorates a single line's monthly price by days elapsed (30-day month convention)", () => {
    const cents = computeEstimatedEarningsCents(
      {
        billingStartedAt: new Date("2026-09-01"),
        endDate: null,
        closedAt: null,
        lines: [{ monthlyPriceCents: 6000 }],
      },
      new Date("2026-09-16"), // 15 days in
    );
    expect(cents).toBe(3000); // half a month of $60
  });

  it("sums multiple lines before prorating", () => {
    const cents = computeEstimatedEarningsCents(
      {
        billingStartedAt: new Date("2026-09-01"),
        endDate: null,
        closedAt: null,
        lines: [{ monthlyPriceCents: 6000 }, { monthlyPriceCents: 4000 }],
      },
      new Date("2026-10-01"), // 30 days
    );
    expect(cents).toBe(10000);
  });

  it("stops proration at the agreement's end date, not asOf, once it's ended", () => {
    const cents = computeEstimatedEarningsCents(
      {
        billingStartedAt: new Date("2026-08-01"),
        endDate: new Date("2026-08-31"), // 30 days
        closedAt: null,
        lines: [{ monthlyPriceCents: 6000 }],
      },
      new Date("2026-09-28"), // well after it ended
    );
    expect(cents).toBe(6000);
  });

  it("stops proration at closedAt for a cancelled month-to-month rental", () => {
    const closedAt = new Date("2026-09-16T00:00:00Z");
    const agreement = {
      billingStartedAt: new Date("2026-09-01T00:00:00Z"),
      endDate: null,
      closedAt,
      lines: [{ monthlyPriceCents: 6000 }],
    };
    expect(computeEstimatedEarningsCents(agreement, closedAt)).toBe(3000);
    expect(
      computeEstimatedEarningsCents(
        agreement,
        new Date("2026-10-16T00:00:00Z"),
      ),
    ).toBe(3000);
  });

  it("uses the earliest of endDate and closedAt", () => {
    const cents = computeEstimatedEarningsCents(
      {
        billingStartedAt: new Date("2026-09-01T00:00:00Z"),
        endDate: new Date("2026-09-11T00:00:00Z"),
        closedAt: new Date("2026-09-20T00:00:00Z"),
        lines: [{ monthlyPriceCents: 6000 }],
      },
      new Date("2026-10-01T00:00:00Z"),
    );
    expect(cents).toBe(2000);
  });

  it("never goes negative for a nonsensical date range", () => {
    const cents = computeEstimatedEarningsCents(
      {
        billingStartedAt: new Date("2026-09-28"),
        endDate: new Date("2026-09-01"), // end before start — shouldn't happen, but don't blow up
        closedAt: null,
        lines: [{ monthlyPriceCents: 6000 }],
      },
      new Date("2026-09-30"),
    );
    expect(cents).toBe(0);
  });
});

describe("computeAgreementEarnings", () => {
  it("reports a positive gap when collections are behind the agreed price", () => {
    const result = computeAgreementEarnings(
      {
        billingStartedAt: new Date("2026-09-01"),
        endDate: null,
        closedAt: null,
        lines: [{ monthlyPriceCents: 6000 }],
        invoicePaidCents: 1000,
      },
      new Date("2026-10-01"),
    );
    expect(result.estimatedCents).toBe(6000);
    expect(result.actualCents).toBe(1000);
    expect(result.gapCents).toBe(5000);
  });

  it("reports a zero (not negative-flagged) gap when collections match or exceed the estimate", () => {
    const result = computeAgreementEarnings(
      {
        billingStartedAt: new Date("2026-09-01"),
        endDate: null,
        closedAt: null,
        lines: [{ monthlyPriceCents: 6000 }],
        invoicePaidCents: 6000,
      },
      new Date("2026-10-01"),
    );
    expect(result.gapCents).toBe(0);
  });
});
