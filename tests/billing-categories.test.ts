import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  receiptFindMany: vi.fn(),
  refundFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (callback: (tx: unknown) => unknown) => {
      mocks.transaction();
      return callback({
        receipt: { findMany: mocks.receiptFindMany },
        refund: { findMany: mocks.refundFindMany },
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
      { amountCents: 1_500 },
      { amountCents: 500 },
    ]);
  });

  it("reports whole receipt cash, refunds, net cash and method totals", async () => {
    const from = new Date("2026-09-01T06:00:00Z");
    const to = new Date("2026-10-01T06:00:00Z");
    const summary = await collectedBetween(null, from, to);

    expect(summary).toEqual({
      grossCents: 13_500,
      refundedCents: 2_000,
      netCents: 11_500,
      byMethod: { card: 11_000, cash: 2_500 },
    });
    expect(mocks.receiptFindMany).toHaveBeenCalledWith({
      where: { receivedOn: { gte: from, lt: to } },
      select: { amountCents: true, method: true },
    });
    expect(mocks.refundFindMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lt: to } },
      select: { amountCents: true },
    });
  });

  it("scopes both receipts and refunds to one customer when requested", async () => {
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
  });
});
