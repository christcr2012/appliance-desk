import { describe, it, expect, vi, beforeEach } from "vitest";

// DB-wrapper half of the Reports page (src/domains/reports/index.ts) — the
// pure math itself is covered by tests/reports-earnings.test.ts. These
// tests check the query shape and result assembly with a mocked Prisma.

const agreementFindMany = vi.fn();
const jobFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: { findMany: (...args: unknown[]) => agreementFindMany(...args) },
    job: { findMany: (...args: unknown[]) => jobFindMany(...args) },
  },
}));

import { getEarningsReport, getJobsMissingRepairCost } from "@/domains/reports";

describe("getEarningsReport", () => {
  beforeEach(() => {
    agreementFindMany.mockReset();
  });

  it("only queries agreements that have started billing", async () => {
    agreementFindMany.mockResolvedValue([]);
    await getEarningsReport(new Date("2026-09-28"));
    const args = agreementFindMany.mock.calls[0][0];
    expect(args.where.billingStartedAt).toEqual({ not: null });
  });

  it("sorts rows worst-gap-first and totals across every row", async () => {
    agreementFindMany.mockResolvedValue([
      {
        id: "agr-behind",
        billingStartedAt: new Date("2026-09-01"),
        endDate: null,
        customer: { id: "cust-1", user: { name: "Jane Doe", email: "jane@example.com" } },
        lines: [{ monthlyPriceCents: 6000 }],
        invoices: [{ amountPaidCents: 1000 }],
      },
      {
        id: "agr-current",
        billingStartedAt: new Date("2026-09-01"),
        endDate: null,
        customer: { id: "cust-2", user: { name: "Sam Renter", email: "sam@example.com" } },
        lines: [{ monthlyPriceCents: 6000 }],
        invoices: [{ amountPaidCents: 6000 }],
      },
    ]);

    const report = await getEarningsReport(new Date("2026-10-01"));

    expect(report.rows).toHaveLength(2);
    expect(report.rows[0].agreementId).toBe("agr-behind");
    expect(report.rows[0].gapCents).toBeGreaterThan(report.rows[1].gapCents);
    expect(report.totals.estimatedCents).toBe(
      report.rows[0].estimatedCents + report.rows[1].estimatedCents,
    );
    expect(report.totals.actualCents).toBe(1000 + 6000);
  });

  it("falls back to the customer's email when they have no name on file", async () => {
    agreementFindMany.mockResolvedValue([
      {
        id: "agr-1",
        billingStartedAt: new Date("2026-09-01"),
        endDate: null,
        customer: { id: "cust-1", user: { name: null, email: "noname@example.com" } },
        lines: [],
        invoices: [],
      },
    ]);
    const report = await getEarningsReport(new Date("2026-09-28"));
    expect(report.rows[0].customerName).toBe("noname@example.com");
  });
});

describe("getJobsMissingRepairCost", () => {
  beforeEach(() => {
    jobFindMany.mockReset().mockResolvedValue([]);
  });

  it("only looks for completed maintenance visits with both costs unset", async () => {
    await getJobsMissingRepairCost();
    const args = jobFindMany.mock.calls[0][0];
    expect(args.where).toEqual({
      type: "MAINTENANCE_VISIT",
      status: "COMPLETED",
      partsCostCents: null,
      laborCostCents: null,
    });
  });
});
