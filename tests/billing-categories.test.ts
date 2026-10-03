import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  receiptFindMany: vi.fn(),
  refundFindMany: vi.fn(),
  depositFindMany: vi.fn(),
  creditFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (callback: (tx: unknown) => unknown) => {
      mocks.transaction();
      return callback({
        receipt: { findMany: mocks.receiptFindMany },
        refund: { findMany: mocks.refundFindMany },
        deposit: { findMany: mocks.depositFindMany },
        customerCredit: { findMany: mocks.creditFindMany },
      });
    },
  },
}));

import {
  categorizeLine,
  collectedBetween,
} from "@/domains/billing/categories";

describe("categorizeLine", () => {
  it.each([
    ["RENTAL", "RENT"],
    ["DELIVERY_FEE", "FEES"],
    ["INSTALLATION_FEE", "FEES"],
    ["REMOVAL_FEE", "FEES"],
    ["DAMAGE_WAIVER", "FEES"],
    ["DEPOSIT", "DEPOSIT"],
    ["TAX", "TAX"],
    ["LATE_FEE", "LATE_FEE"],
    ["PREPAY_DISCOUNT", "DISCOUNT"],
    ["CREDIT", "CREDIT"],
    ["ADJUSTMENT", "FEES"],
  ] as const)("maps %s to %s", (kind, category) => {
    expect(categorizeLine(kind)).toBe(category);
  });
});

describe("collectedBetween", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.receiptFindMany.mockResolvedValue([
      { amountCents: 10_000, method: "card" },
      { amountCents: 2_500, method: "cash" },
      { amountCents: 1_000, method: "card" },
    ]);
    mocks.refundFindMany.mockResolvedValue([
      { id: "refund-cash", amountCents: 1_500 },
      { id: "refund-credit", amountCents: 500 },
    ]);
    mocks.depositFindMany.mockResolvedValue([{ refundedAmountCents: 750 }]);
    mocks.creditFindMany.mockResolvedValue([
      { sourceId: "refund-credit" },
    ]);
  });

  it("reports whole receipt cash minus only cash refunds, including returned deposits", async () => {
    const from = new Date("2026-09-01T06:00:00Z");
    const to = new Date("2026-10-01T06:00:00Z");
    const summary = await collectedBetween(null, from, to);

    expect(summary).toEqual({
      grossCents: 13_500,
      refundedCents: 2_250,
      netCents: 11_250,
      byMethod: { card: 11_000, cash: 2_500 },
    });
    expect(mocks.receiptFindMany).toHaveBeenCalledWith({
      where: { receivedOn: { gte: from, lt: to } },
      select: { amountCents: true, method: true },
    });
    expect(mocks.refundFindMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lt: to } },
      select: { id: true, amountCents: true },
    });
    expect(mocks.creditFindMany).toHaveBeenCalledWith({
      where: {
        sourceType: "REFUND_TO_CREDIT",
        sourceId: { in: ["refund-cash", "refund-credit"] },
      },
      select: { sourceId: true },
    });
  });

  it("scopes receipts, invoice refunds and deposit refunds to one customer", async () => {
    const from = new Date("2026-09-01T06:00:00Z");
    const to = new Date("2026-10-01T06:00:00Z");
    await collectedBetween("cust-1", from, to);

    expect(mocks.receiptFindMany.mock.calls[0][0].where).toEqual({
      customerId: "cust-1",
      receivedOn: { gte: from, lt: to },
    });
    expect(mocks.refundFindMany.mock.calls[0][0].where).toEqual({
      invoice: { customerId: "cust-1" },
      createdAt: { gte: from, lt: to },
    });
    expect(mocks.depositFindMany.mock.calls[0][0].where).toEqual({
      refundedAt: { gte: from, lt: to },
      agreement: { customerId: "cust-1" },
    });
  });

  it("does not query refund-to-credit provenance when the period has no invoice refunds", async () => {
    mocks.refundFindMany.mockResolvedValue([]);
    const from = new Date("2026-09-01T06:00:00Z");
    const to = new Date("2026-10-01T06:00:00Z");
    await collectedBetween(null, from, to);
    expect(mocks.creditFindMany).not.toHaveBeenCalled();
  });
});
