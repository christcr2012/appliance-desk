import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  agreements: vi.fn(),
  rentals: vi.fn(),
  payments: vi.fn(),
  failures: vi.fn(),
  invoices: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: { findMany: m.agreements, count: m.rentals },
    payment: { aggregate: m.payments, count: m.failures },
    invoice: { findMany: m.invoices },
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripeClient: vi.fn() }));
import { getRevenueDashboard } from "@/domains/billing";

it("reconciles rates, gross payment sums and partially paid balances with consistent UTC bounds", async () => {
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
  m.payments
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
  const period = { gte: new Date("2026-10-01T00:00:00Z"), lte: now };
  expect(m.payments.mock.calls[0][0].where).toEqual({
    status: "succeeded",
    createdAt: period,
  });
  expect(m.rentals.mock.calls[0][0].where.startDate).toEqual(period);
  expect(m.rentals.mock.calls[1][0].where.updatedAt).toEqual(period);
  expect(m.failures.mock.calls[0][0].where.createdAt).toEqual(period);
  expect(m.agreements.mock.calls[0][0].where.billingStartedAt).toEqual({
    not: null,
    lte: now,
  });
  expect(m.invoices.mock.calls[0][0].where.status.in).toContain(
    "PARTIALLY_PAID",
  );
});
