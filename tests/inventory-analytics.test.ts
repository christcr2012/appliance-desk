import { describe, it, expect } from "vitest";
import {
  computeAssignmentRevenueCents,
  computeApplianceRevenueCents,
  computeUtilizationFraction,
  computeRepairCostCents,
  computeProfitability,
} from "@/domains/inventory/analytics";

// These are the pure calculations getFleetAnalytics/getApplianceProfitability
// (src/domains/inventory/index.ts) build on — see analytics.ts's own doc
// comments for what each approximates and why. Pure and exported
// specifically so they're unit-testable without a real database.

describe("computeAssignmentRevenueCents", () => {
  it("prorates a full 30-day month at the full line price", () => {
    const cents = computeAssignmentRevenueCents(
      {
        assignedAt: new Date("2026-01-01"),
        unassignedAt: new Date("2026-01-31"),
        monthlyPriceCents: 6000,
        applianceCountOnLine: 1,
      },
      new Date("2026-06-01"),
    );
    expect(cents).toBe(6000);
  });

  it("splits the line's price evenly across appliances sharing it (a set)", () => {
    const cents = computeAssignmentRevenueCents(
      {
        assignedAt: new Date("2026-01-01"),
        unassignedAt: new Date("2026-01-31"),
        monthlyPriceCents: 6000,
        applianceCountOnLine: 2,
      },
      new Date("2026-06-01"),
    );
    expect(cents).toBe(3000);
  });

  it("uses `asOf` instead of unassignedAt when still assigned", () => {
    const cents = computeAssignmentRevenueCents(
      {
        assignedAt: new Date("2026-01-01"),
        unassignedAt: null,
        monthlyPriceCents: 3000,
        applianceCountOnLine: 1,
      },
      new Date("2026-01-31"),
    );
    expect(cents).toBe(3000);
  });

  it("returns 0 for an assignment that hasn't started relative to asOf", () => {
    const cents = computeAssignmentRevenueCents(
      {
        assignedAt: new Date("2026-06-01"),
        unassignedAt: null,
        monthlyPriceCents: 3000,
        applianceCountOnLine: 1,
      },
      new Date("2026-01-01"),
    );
    expect(cents).toBe(0);
  });
});

describe("computeApplianceRevenueCents", () => {
  it("sums revenue across multiple, non-overlapping assignment periods", () => {
    const cents = computeApplianceRevenueCents(
      [
        {
          assignedAt: new Date("2026-01-01"),
          unassignedAt: new Date("2026-01-31"),
          monthlyPriceCents: 3000,
          applianceCountOnLine: 1,
        },
        {
          assignedAt: new Date("2026-03-01"),
          unassignedAt: new Date("2026-03-31"),
          monthlyPriceCents: 3000,
          applianceCountOnLine: 1,
        },
      ],
      new Date("2026-06-01"),
    );
    expect(cents).toBe(6000);
  });

  it("returns 0 for an appliance that's never been assigned", () => {
    expect(computeApplianceRevenueCents([], new Date())).toBe(0);
  });
});

describe("computeUtilizationFraction", () => {
  it("is 1.0 for an appliance assigned its entire time in the fleet", () => {
    const fraction = computeUtilizationFraction(
      [{ assignedAt: new Date("2026-01-01"), unassignedAt: null }],
      new Date("2026-01-01"),
      new Date("2026-01-31"),
    );
    expect(fraction).toBe(1);
  });

  it("is 0.5 for an appliance assigned half its time in the fleet", () => {
    const fraction = computeUtilizationFraction(
      [{ assignedAt: new Date("2026-01-01"), unassignedAt: new Date("2026-01-16") }],
      new Date("2026-01-01"),
      new Date("2026-01-31"),
    );
    expect(fraction).toBeCloseTo(0.5, 1);
  });

  it("is 0 for a brand-new appliance never assigned", () => {
    const fraction = computeUtilizationFraction(
      [],
      new Date("2026-01-01"),
      new Date("2026-01-01"),
    );
    expect(fraction).toBe(0);
  });

  it("never exceeds 1.0 even with overlapping/odd data", () => {
    const fraction = computeUtilizationFraction(
      [
        { assignedAt: new Date("2025-01-01"), unassignedAt: null },
        { assignedAt: new Date("2026-01-01"), unassignedAt: null },
      ],
      new Date("2026-01-01"),
      new Date("2026-01-31"),
    );
    expect(fraction).toBeLessThanOrEqual(1);
  });
});

describe("computeRepairCostCents", () => {
  it("sums parts + labor across jobs", () => {
    const cents = computeRepairCostCents([
      { partsCostCents: 1000, laborCostCents: 500 },
      { partsCostCents: 200, laborCostCents: null },
    ]);
    expect(cents).toBe(1700);
  });

  it("treats a job with no cost entered as $0, not an error", () => {
    const cents = computeRepairCostCents([
      { partsCostCents: null, laborCostCents: null },
    ]);
    expect(cents).toBe(0);
  });

  it("returns 0 for no repair jobs at all", () => {
    expect(computeRepairCostCents([])).toBe(0);
  });
});

describe("computeProfitability", () => {
  it("matches the proposal's own worked example (Washer W-0047)", () => {
    // Purchase Cost: $310; Lifetime Rental Revenue: $1,085; Repair Costs:
    // $92; Net Contribution: $683 — from
    // docs/reviews/2026-09-27-friend-full-rebuild-proposal.md.
    const result = computeProfitability({
      revenueCents: 108500,
      repairCostCents: 9200,
      acquisitionCostCents: 31000,
    });
    expect(result.netContributionCents).toBe(68300);
    expect(result.paidForItself).toBe(true);
  });

  it("says not paid for itself when revenue net of repairs is under cost", () => {
    const result = computeProfitability({
      revenueCents: 10000,
      repairCostCents: 2000,
      acquisitionCostCents: 50000,
    });
    expect(result.paidForItself).toBe(false);
    expect(result.netContributionCents).toBeLessThan(0);
  });

  it("treats a missing acquisition cost as $0, not an error", () => {
    const result = computeProfitability({
      revenueCents: 5000,
      repairCostCents: 0,
      acquisitionCostCents: null,
    });
    expect(result.acquisitionCostCents).toBe(0);
    expect(result.paidForItself).toBe(true);
  });
});
