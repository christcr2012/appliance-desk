import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  role: vi.fn(),
  tx: vi.fn(),
  aggregate: vi.fn(),
  rows: vi.fn(),
  refundAggregate: vi.fn(),
  refunds: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.tx } }));
import {
  getRevenueRecords,
  revenuePeriod,
} from "@/domains/billing/revenue-records";
const asOf = new Date("2026-10-01T00:30:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({});
  m.aggregate.mockResolvedValue({
    _count: { _all: 26 },
    _sum: { amountCents: 5400 },
  });
  m.refundAggregate.mockResolvedValue({
    _count: { _all: 1 },
    _sum: { amountCents: 600 },
  });
  m.rows.mockResolvedValue([
    {
      id: "p1",
      createdAt: asOf,
      amountCents: 5400,
      method: "cash",
      recordedByUserId: "owner",
      invoice: {
        id: "i1",
        customerId: "c1",
        invoiceNumber: 10,
        customer: {
          user: { name: "Customer", email: "customer@example.test" },
        },
      },
    },
  ]);
  m.refunds.mockResolvedValue([]);
  m.tx.mockImplementation((fn) =>
    fn({
      payment: { aggregate: m.aggregate, findMany: m.rows },
      refund: { aggregate: m.refundAggregate, findMany: m.refunds },
    }),
  );
});
it("uses UTC month boundaries and excludes future record timestamps", () => {
  expect(revenuePeriod(asOf, true)).toEqual({
    gte: new Date("2026-10-01T00:00:00Z"),
    lte: asOf,
  });
  expect(revenuePeriod(asOf, false)).toEqual({ lte: asOf });
});
it("reconciles sum/count and bounded stable payment rows with one snapshot and exact invoice links", async () => {
  const result = await getRevenueRecords("payments", true, "999", asOf);
  expect(result.meta).toMatchObject({
    page: 2,
    totalCount: 26,
    skip: 25,
    pageSize: 25,
  });
  expect(result.totalCents).toBe(5400);
  const aggregate = m.aggregate.mock.calls[0][0];
  const read = m.rows.mock.calls[0][0];
  expect(aggregate.where).toEqual(read.where);
  expect(read.where.status).toBe("succeeded");
  expect(read).toMatchObject({
    take: 25,
    skip: 25,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  expect(result.rows[0]).toMatchObject({
    basis: "Owner-recorded payment",
    invoice: { id: "i1", customerId: "c1" },
  });
  expect(result.rows[0]).not.toHaveProperty("recordedByUserId");
  expect(m.tx.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
  expect(m.refunds).not.toHaveBeenCalled();
});
it("reads invoice refunds separately without treating them as gross payments", async () => {
  const result = await getRevenueRecords("refunds", false, "1", asOf);
  expect(result.totalCents).toBe(600);
  expect(m.refunds.mock.calls[0][0].where).toEqual({
    createdAt: { lte: asOf },
  });
  expect(m.aggregate).not.toHaveBeenCalled();
});
it("denies unauthorized roles before touching the database", async () => {
  m.role.mockRejectedValue(new Error("Forbidden"));
  await expect(getRevenueRecords("payments", true)).rejects.toThrow(
    "Forbidden",
  );
  expect(m.tx).not.toHaveBeenCalled();
  expect(m.role).toHaveBeenCalledWith("OWNER", "ADMIN");
});
