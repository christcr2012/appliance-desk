import { beforeEach, describe, expect, it, vi } from "vitest";

const agreementFindMany = vi.fn();
const jobFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: {
      findMany: (...args: unknown[]) => agreementFindMany(...args),
    },
    job: { findMany: (...args: unknown[]) => jobFindMany(...args) },
  },
}));

import { getEarningsReport, getJobsMissingRepairCost } from "@/domains/reports";

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    amountDueCents: 6_000,
    payments: [{ amountCents: 6_000 }],
    refunds: [],
    ...overrides,
  };
}

describe("getEarningsReport", () => {
  beforeEach(() => agreementFindMany.mockReset());

  it("only queries agreements that had started billing by the snapshot", async () => {
    agreementFindMany.mockResolvedValue([]);
    const asOf = new Date("2026-09-28T12:00:00Z");
    await getEarningsReport(asOf);
    const args = agreementFindMany.mock.calls[0][0];
    expect(args.where.billingStartedAt).toEqual({ not: null, lte: asOf });
    expect(args.select.invoices.where.createdAt).toEqual({ lte: asOf });
  });

  it("uses invoice charges vs receipt allocations minus refunds and sorts biggest gap first", async () => {
    agreementFindMany.mockResolvedValue([
      {
        id: "agr-behind",
        customer: {
          id: "cust-1",
          user: { name: "Jane Doe", email: "jane@example.com" },
        },
        invoices: [
          invoice({
            amountDueCents: 12_000,
            payments: [{ amountCents: 8_000 }],
            refunds: [{ amountCents: 1_000 }],
          }),
        ],
      },
      {
        id: "agr-current",
        customer: {
          id: "cust-2",
          user: { name: "Sam Renter", email: "sam@example.com" },
        },
        invoices: [invoice()],
      },
    ]);

    const report = await getEarningsReport(new Date("2026-10-01T12:00:00Z"));

    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]).toMatchObject({
      agreementId: "agr-behind",
      expectedChargesCents: 12_000,
      netCollectedCents: 7_000,
      gapCents: 5_000,
    });
    expect(report.rows[1]).toMatchObject({
      agreementId: "agr-current",
      expectedChargesCents: 6_000,
      netCollectedCents: 6_000,
      gapCents: 0,
    });
    expect(report.totals).toEqual({
      expectedChargesCents: 18_000,
      netCollectedCents: 13_000,
      gapCents: 5_000,
    });
  });

  it("cannot let a non-rent charge mask a shortfall through a mismatched basis", async () => {
    agreementFindMany.mockResolvedValue([
      {
        id: "agr-mixed",
        customer: {
          id: "cust-1",
          user: { name: null, email: "noname@example.com" },
        },
        // Whole invoice basis: rent + deposit + tax = 16,438 due, while only
        // 12,000 of actual receipt allocations remain after refund.
        invoices: [
          invoice({
            amountDueCents: 16_438,
            payments: [{ amountCents: 13_000 }],
            refunds: [{ amountCents: 1_000 }],
          }),
        ],
      },
    ]);

    const report = await getEarningsReport(new Date("2026-10-01T12:00:00Z"));
    expect(report.rows[0]).toMatchObject({
      customerName: "noname@example.com",
      expectedChargesCents: 16_438,
      netCollectedCents: 12_000,
      gapCents: 4_438,
    });
  });
});

describe("getJobsMissingRepairCost", () => {
  beforeEach(() => jobFindMany.mockReset().mockResolvedValue([]));

  it("flags a completed maintenance visit when either cost input is missing", async () => {
    await getJobsMissingRepairCost();
    const args = jobFindMany.mock.calls[0][0];
    expect(args.where).toEqual({
      type: "MAINTENANCE_VISIT",
      status: "COMPLETED",
      OR: [{ partsCostCents: null }, { laborCostCents: null }],
    });
  });
});
