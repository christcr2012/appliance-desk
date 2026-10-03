import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  role: vi.fn(),
  tx: vi.fn(),
  aggregate: vi.fn(),
  rows: vi.fn(),
  refundAggregate: vi.fn(),
  refunds: vi.fn(),
  credits: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.tx } }));
import { getRevenueRecords, revenuePeriod } from "@/domains/billing/revenue-records";
// 18:30 on Sept 30 in Colorado, but already Oct 1 in UTC.
const asOf = new Date("2026-10-01T00:30:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({});
  m.aggregate.mockResolvedValue({ _count: { _all: 26 }, _sum: { amountCents: 5400 } });
  m.refundAggregate.mockResolvedValue({ _count: { _all: 2 }, _sum: { amountCents: 900 } });
  m.rows.mockResolvedValue([
    {
      id: "r1",
      receivedOn: asOf,
      amountCents: 5400,
      method: "check",
      source: "MANUAL",
      recordedByUserId: "owner",
      customer: { id: "c1", user: { name: "Customer", email: "customer@example.test" } },
      payments: [
        { amountCents: 3000, invoice: { id: "i1", invoiceNumber: 10 } },
        { amountCents: 2400, invoice: { id: "i2", invoiceNumber: 11 } },
      ],
    },
  ]);
  m.refunds.mockResolvedValue([
    { id: "f1", amountCents: 600, createdAt: asOf, invoice: { id: "i1", invoiceNumber: 10, customerId: "c1", customer: { user: { name: "Customer", email: "customer@example.test" } } } },
    { id: "f2", amountCents: 300, createdAt: asOf, invoice: { id: "i2", invoiceNumber: 11, customerId: "c1", customer: { user: { name: null, email: "customer@example.test" } } } },
  ]);
  m.credits.mockResolvedValue([{ sourceId: "f2", amountCents: 300 }]);
  m.tx.mockImplementation((fn) =>
    fn({
      receipt: { aggregate: m.aggregate, findMany: m.rows },
      refund: { aggregate: m.refundAggregate, findMany: m.refunds },
      customerCredit: { findMany: m.credits },
    }),
  );
});
it("uses the Colorado calendar month and excludes future record timestamps", () => {
  // asOf is still September in Denver, so the month starts Sept 1 at 6am UTC (MDT).
  expect(revenuePeriod(asOf, true)).toEqual({ gte: new Date("2026-09-01T06:00:00Z"), lte: asOf });
  expect(revenuePeriod(asOf, false)).toEqual({ lte: asOf });
});
it("lists each receipt once with its invoices and reconciles count, sum and rows in one snapshot", async () => {
  const result = await getRevenueRecords("payments", true, "999", asOf);
  expect(result.meta).toMatchObject({ page: 2, totalCount: 26, skip: 25, pageSize: 25 });
  expect(result.totalCents).toBe(5400);
  const aggregate = m.aggregate.mock.calls[0][0];
  const read = m.rows.mock.calls[0][0];
  expect(aggregate.where).toEqual(read.where);
  expect(read.where).toEqual({ receivedOn: { gte: new Date("2026-09-01T06:00:00Z"), lte: asOf } });
  expect(read).toMatchObject({
    take: 25,
    skip: 25,
    orderBy: [{ receivedOn: "desc" }, { id: "desc" }],
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    basis: "Owner-recorded payment",
    customerId: "c1",
    method: "check",
    unallocatedCents: 0,
    invoices: [
      { id: "i1", invoiceNumber: 10, amountCents: 3000 },
      { id: "i2", invoiceNumber: 11, amountCents: 2400 },
    ],
  });
  expect(result.rows[0]).not.toHaveProperty("recordedByUserId");
  expect(m.tx.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
  expect(m.refunds).not.toHaveBeenCalled();
});
it("shows an overpayment as money held as account credit", async () => {
  m.rows.mockResolvedValue([
    {
      id: "r2",
      receivedOn: asOf,
      amountCents: 10000,
      method: "card",
      source: "STRIPE",
      recordedByUserId: null,
      customer: { id: "c1", user: { name: "Customer", email: "customer@example.test" } },
      payments: [{ amountCents: 4000, invoice: { id: "i1", invoiceNumber: 10 } }],
    },
  ]);
  const result = await getRevenueRecords("payments", true, "1", asOf);
  expect(result.rows[0]).toMatchObject({ amountCents: 10000, unallocatedCents: 6000, basis: "Card or Stripe payment" });
});
it("keeps a payment that arrived after its invoice was closed apart from applied money and from account credit", async () => {
  m.rows.mockResolvedValue([
    {
      id: "r3",
      receivedOn: asOf,
      amountCents: 10000,
      method: "card",
      source: "STRIPE",
      recordedByUserId: null,
      customer: { id: "c1", user: { name: "Customer", email: "customer@example.test" } },
      payments: [{ amountCents: 10000, status: "held", invoice: { id: "i9", invoiceNumber: 99 } }],
    },
  ]);
  const result = await getRevenueRecords("payments", true, "1", asOf);
  expect(result.rows[0]).toMatchObject({ amountCents: 10000, heldCents: 10000, unallocatedCents: 0, invoices: [] });
});
it("a settled held payment no longer shows as held: credit counts as unallocated, a card refund counts as neither", async () => {
  const base = {
    receivedOn: asOf,
    amountCents: 10000,
    method: "card",
    source: "STRIPE",
    recordedByUserId: null,
    customer: { id: "c1", user: { name: "Customer", email: "customer@example.test" } },
  };
  m.rows.mockResolvedValue([
    { ...base, id: "r4", payments: [{ amountCents: 10000, status: "held_to_credit", invoice: { id: "i1", invoiceNumber: 1 } }] },
    { ...base, id: "r5", payments: [{ amountCents: 10000, status: "held_refunded", invoice: { id: "i2", invoiceNumber: 2 } }] },
  ]);
  const result = await getRevenueRecords("payments", true, "1", asOf);
  expect(result.rows[0]).toMatchObject({ heldCents: 0, unallocatedCents: 10000, invoices: [] });
  expect(result.rows[1]).toMatchObject({ heldCents: 0, unallocatedCents: 0, invoices: [] });
});
it("reads refunds separately and says which ones returned no cash", async () => {
  const result = await getRevenueRecords("refunds", false, "1", asOf);
  expect(result.totalCents).toBe(900);
  expect(result.toCreditCents).toBe(300);
  expect(m.refunds.mock.calls[0][0].where).toEqual({ createdAt: { lte: asOf } });
  expect(m.aggregate).not.toHaveBeenCalled();
  expect(result.rows.map((r) => r.basis)).toEqual([
    "Refund returned to the customer",
    "Refund kept as account credit (no cash returned)",
  ]);
});
it("denies unauthorized roles before touching the database", async () => {
  m.role.mockRejectedValue(new Error("Forbidden"));
  await expect(getRevenueRecords("payments", true)).rejects.toThrow("Forbidden");
  expect(m.tx).not.toHaveBeenCalled();
  expect(m.role).toHaveBeenCalledWith("OWNER", "ADMIN");
});
