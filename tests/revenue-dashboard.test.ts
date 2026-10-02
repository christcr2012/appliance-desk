import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  agreements: vi.fn(),
  rentals: vi.fn(),
  receipts: vi.fn(),
  failures: vi.fn(),
  invoices: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: { findMany: m.agreements, count: m.rentals },
    receipt: { aggregate: m.receipts },
    payment: { count: m.failures },
    invoice: { findMany: m.invoices },
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripeClient: vi.fn() }));
import { getRevenueDashboard } from "@/domains/billing";

it("reconciles rates, receipt cash totals and partially paid balances with Colorado cash-month bounds", async () => {
  // 00:30 UTC on October 1 is still September 30 in Colorado. Receipt cash
  // must therefore remain in September even though older rate metrics keep
  // their existing UTC period contract.
  const now = new Date("2026-10-01T00:30:00Z");
  m.agreements
    .mockResolvedValueOnce([
      {
        customerId: "c1",
        lines: [{ monthlyPriceCents: 5000 }, { monthlyPriceCents: 3000 }],
      },
    ])
    .mockResolvedValueOnce([
      {
        billingStartedAt: new Date("2026-09-01T00:00:00Z"),
        endDate: null,
        lines: [{ monthlyPriceCents: 8000 }],
      },
    ])
    .mockResolvedValueOnce([{ customerId: "c1" }]);
  m.rentals.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
  m.receipts
    .mockResolvedValueOnce({ _sum: { amountCents: 5400 } })
    .mockResolvedValueOnce({ _sum: { amountCents: 8000 } });
  m.invoices.mockResolvedValue([
    { amountDueCents: 6000, amountPaidCents: 1000 },
    { amountDueCents: 2000, amountPaidCents: 2500 },
  ]);
  m.failures.mockResolvedValue(2);

  const result = await getRevenueDashboard(now);
  expect(result).toMatchObject({
    mrrCents: 8000,
    arrCents: 96000,
    collectedThisMonthCents: 5400,
    collectedAllTimeCents: 8000,
    pastDueCents: 5000,
    pastDueInvoiceCount: 1,
    activeCustomerCount: 1,
  });

  const ratePeriod = { gte: new Date("2026-10-01T00:00:00Z"), lte: now };
  const cashPeriod = { gte: new Date("2026-09-01T06:00:00Z"), lte: now };
  expect(m.receipts.mock.calls[0][0].where).toEqual({ receivedOn: cashPeriod });
  expect(m.rentals.mock.calls[0][0].where.startDate).toEqual(ratePeriod);
  expect(m.rentals.mock.calls[1][0].where.updatedAt).toEqual(ratePeriod);
  expect(m.failures.mock.calls[0][0].where.createdAt).toEqual(ratePeriod);
  expect(m.agreements.mock.calls[0][0].where.billingStartedAt).toEqual({
    not: null,
    lte: now,
  });
  expect(m.invoices.mock.calls[0][0].where.status.in).toContain(
    "PARTIALLY_PAID",
  );
});
