import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  tx: vi.fn(),
  receiptAggregate: vi.fn(),
  receipts: vi.fn(),
  refundAggregate: vi.fn(),
  refunds: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.tx } }));

import {
  cashRevenuePeriod,
  getRevenueRecords,
  revenuePeriod,
} from "@/domains/billing/revenue-records";

const asOf = new Date("2026-10-01T00:30:00Z"); // Sep 30, 6:30 PM MDT

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({});
  m.receiptAggregate.mockResolvedValue({
    _count: { _all: 26 },
    _sum: { amountCents: 8400 },
  });
  m.refundAggregate.mockResolvedValue({
    _count: { _all: 1 },
    _sum: { amountCents: 600 },
  });
  m.receipts.mockResolvedValue([
    {
      id: "receipt-1",
      source: "MANUAL",
      amountCents: 8400,
      method: "cash",
      receivedOn: asOf,
      customer: {
        id: "c1",
        user: { name: "Customer", email: "customer@example.test" },
      },
      payments: [
        {
          invoice: {
            id: "i1",
            customerId: "c1",
            invoiceNumber: 10,
            customer: {
              user: { name: "Customer", email: "customer@example.test" },
            },
          },
        },
      ],
    },
  ]);
  m.refunds.mockResolvedValue([]);
  m.tx.mockImplementation((fn) =>
    fn({
      receipt: { aggregate: m.receiptAggregate, findMany: m.receipts },
      refund: { aggregate: m.refundAggregate, findMany: m.refunds },
    }),
  );
});

it("keeps rate metrics on UTC month while cash uses Colorado business month", () => {
  expect(revenuePeriod(asOf, true)).toEqual({
    gte: new Date("2026-10-01T00:00:00.000Z"),
    lte: asOf,
  });
  expect(cashRevenuePeriod(asOf, true)).toEqual({
    gte: new Date("2026-09-01T06:00:00.000Z"),
    lte: asOf,
  });
  expect(cashRevenuePeriod(asOf, false)).toEqual({ lte: asOf });
});

it("reconciles sum/count and bounded stable receipt rows in one snapshot", async () => {
  const result = await getRevenueRecords("payments", true, "999", asOf);
  expect(result.meta).toMatchObject({
    page: 2,
    totalCount: 26,
    skip: 25,
    pageSize: 25,
  });
  expect(result.totalCents).toBe(8400);
  const aggregate = m.receiptAggregate.mock.calls[0][0];
  const read = m.receipts.mock.calls[0][0];
  expect(aggregate.where).toEqual(read.where);
  expect(read).toMatchObject({
    take: 25,
    skip: 25,
    orderBy: [{ receivedOn: "desc" }, { id: "desc" }],
  });
  expect(result.rows[0]).toMatchObject({
    id: "receipt-1",
    receiptId: "receipt-1",
    source: "MANUAL",
    basis: "Owner-recorded cash receipt",
    invoice: { id: "i1", customerId: "c1" },
  });
  expect(m.tx.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
  expect(m.refunds).not.toHaveBeenCalled();
});

it("keeps a multi-invoice or overpayment receipt as one cash row", async () => {
  m.receipts.mockResolvedValue([
    {
      id: "receipt-combined",
      source: "MANUAL",
      amountCents: 25_000,
      method: "check",
      receivedOn: asOf,
      customer: {
        id: "c1",
        user: { name: "Customer", email: "customer@example.test" },
      },
      payments: [
        {
          invoice: {
            id: "i1",
            customerId: "c1",
            invoiceNumber: 10,
            customer: { user: { name: "Customer", email: "customer@example.test" } },
          },
        },
        {
          invoice: {
            id: "i2",
            customerId: "c1",
            invoiceNumber: 11,
            customer: { user: { name: "Customer", email: "customer@example.test" } },
          },
        },
      ],
    },
  ]);

  const result = await getRevenueRecords("payments", false, "1", asOf);
  expect(result.rows[0]).toMatchObject({
    id: "receipt-combined",
    amountCents: 25_000,
    invoice: null,
    allocationCount: 2,
  });
});

it("reads invoice refunds separately without treating them as gross receipts", async () => {
  const result = await getRevenueRecords("refunds", false, "1", asOf);
  expect(result.totalCents).toBe(600);
  expect(m.refunds.mock.calls[0][0].where).toEqual({
    createdAt: { lte: asOf },
  });
  expect(m.receiptAggregate).not.toHaveBeenCalled();
});

it("denies unauthorized roles before touching the database", async () => {
  m.role.mockRejectedValue(new Error("Forbidden"));
  await expect(getRevenueRecords("payments", true)).rejects.toThrow("Forbidden");
  expect(m.tx).not.toHaveBeenCalled();
  expect(m.role).toHaveBeenCalledWith("OWNER", "ADMIN");
});
