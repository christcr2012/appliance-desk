import { describe, it, expect } from "vitest";
import { computeMrrTrend } from "@/domains/billing/revenue";

// See src/domains/billing/revenue.ts's own doc comment for what this
// reconstructs and its known limits — used by getRevenueDashboard
// (src/domains/billing/index.ts) for the /desk/revenue trend chart.

describe("computeMrrTrend", () => {
  // Billing starts at delivery, not at signing (2026-09-28) — an
  // agreement that's signed but has no billingStartedAt yet (not
  // delivered) contributes nothing, in any month.
  it("counts nothing for an agreement that's signed but hasn't started billing yet", () => {
    const points = computeMrrTrend(
      [{ billingStartedAt: null, endDate: null, lines: [{ monthlyPriceCents: 5000 }] }],
      3,
      new Date("2026-06-15"),
    );
    expect(points.every((p) => p.mrrCents === 0)).toBe(true);
  });

  it("shows $0 for months before any agreement started", () => {
    const points = computeMrrTrend(
      [
        {
          billingStartedAt: new Date("2026-06-01"),
          endDate: null,
          lines: [{ monthlyPriceCents: 5000 }],
        },
      ],
      3,
      new Date("2026-06-15"),
    );
    // months: Apr, May, Jun
    expect(points).toHaveLength(3);
    expect(points[0].mrrCents).toBe(0); // April — before it started
    expect(points[1].mrrCents).toBe(0); // May — before it started
    expect(points[2].mrrCents).toBe(5000); // June — started
  });

  it("drops an agreement's revenue from the month after it ended", () => {
    const points = computeMrrTrend(
      [
        {
          billingStartedAt: new Date("2026-01-01"),
          endDate: new Date("2026-02-15"),
          lines: [{ monthlyPriceCents: 6000 }],
        },
      ],
      3,
      new Date("2026-03-01"),
    );
    // months: Jan, Feb, Mar
    expect(points[0].mrrCents).toBe(6000); // Jan — active
    expect(points[1].mrrCents).toBe(6000); // Feb — ended mid-month, still counted
    expect(points[2].mrrCents).toBe(0); // Mar — ended before this month began
  });

  it("sums multiple agreements' rental lines in the same month", () => {
    const points = computeMrrTrend(
      [
        {
          billingStartedAt: new Date("2026-01-01"),
          endDate: null,
          lines: [{ monthlyPriceCents: 3000 }],
        },
        {
          billingStartedAt: new Date("2026-01-01"),
          endDate: null,
          lines: [{ monthlyPriceCents: 4000 }, { monthlyPriceCents: 2000 }],
        },
      ],
      1,
      new Date("2026-01-15"),
    );
    expect(points[0].mrrCents).toBe(9000);
  });

  it("returns one point per requested month, oldest first", () => {
    const points = computeMrrTrend([], 6, new Date("2026-06-15"));
    expect(points).toHaveLength(6);
    expect(points.every((p) => p.mrrCents === 0)).toBe(true);
  });
});


it("does not project a future billing start into the current month", () => {
  const result = computeMrrTrend([{ billingStartedAt: new Date("2026-06-25T00:00:00Z"), endDate: null, lines: [{ monthlyPriceCents: 5000 }] }], 1, new Date("2026-06-15T00:00:00Z"));
  expect(result[0].mrrCents).toBe(0);
});
it("does not include an agreement ending exactly at the month's opening boundary", () => {
  const result = computeMrrTrend([{ billingStartedAt: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-06-01T00:00:00Z"), lines: [{ monthlyPriceCents: 5000 }] }], 1, new Date("2026-06-15T00:00:00Z"));
  expect(result[0].mrrCents).toBe(0);
});
