import { describe, it, expect, vi, beforeEach } from "vitest";

// getAccountingTransactions (src/domains/reports/accounting-export.ts,
// Task #73) — a flat, signed ledger of every real payment, refund, and
// security deposit movement, for the accounting CSV export.

const transaction = vi.fn();
const paymentFindMany = vi.fn();
const refundFindMany = vi.fn();
const depositFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => transaction(...args),
    payment: { findMany: (...args: unknown[]) => paymentFindMany(...args) },
    refund: { findMany: (...args: unknown[]) => refundFindMany(...args) },
    deposit: { findMany: (...args: unknown[]) => depositFindMany(...args) },
  },
}));

import { getAccountingTransactions } from "@/domains/reports/accounting-export";

function customerRef(
  overrides: {
    name?: string | null;
    email?: string;
    company?: string | null;
  } = {},
) {
  return {
    companyName: overrides.company ?? null,
    user: {
      // "name" in overrides, not ??, so an explicit null (testing the
      // no-name fallback) isn't silently replaced by the default.
      name: "name" in overrides ? overrides.name : "Jane Doe",
      email: overrides.email ?? "jane@example.com",
    },
  };
}

describe("getAccountingTransactions", () => {
  beforeEach(() => {
    transaction.mockReset().mockImplementation((callback) =>
      callback({
        payment: { findMany: (...args: unknown[]) => paymentFindMany(...args) },
        refund: { findMany: (...args: unknown[]) => refundFindMany(...args) },
        deposit: { findMany: (...args: unknown[]) => depositFindMany(...args) },
      }),
    );
    paymentFindMany.mockReset().mockResolvedValue([]);
    refundFindMany.mockReset().mockResolvedValue([]);
    depositFindMany.mockReset().mockResolvedValue([]);
  });

  it("only queries succeeded payments", async () => {
    await getAccountingTransactions();
    const args = paymentFindMany.mock.calls[0][0];
    expect(args.where).toEqual({ status: "succeeded" });
    expect(transaction.mock.calls[0][1]).toEqual({
      isolationLevel: "RepeatableRead",
    });
  });

  it("includes a succeeded payment as a positive amount", async () => {
    paymentFindMany.mockResolvedValue([
      {
        amountCents: 6000,
        method: "card",
        createdAt: new Date("2026-05-01"),
        invoice: { invoiceNumber: 101, customer: customerRef() },
      },
    ]);
    const rows = await getAccountingTransactions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "Payment",
      amountCents: 6000,
      invoiceNumber: 101,
    });
  });

  it("includes a refund as a negative amount", async () => {
    refundFindMany.mockResolvedValue([
      {
        amountCents: 2000,
        reason: "GOODWILL",
        notes: "Late delivery",
        createdAt: new Date("2026-05-05"),
        invoice: { invoiceNumber: 102, customer: customerRef() },
      },
    ]);
    const rows = await getAccountingTransactions();
    expect(rows[0]).toMatchObject({
      type: "Refund",
      amountCents: -2000,
      methodOrReason: "GOODWILL",
      notes: "Late delivery",
    });
  });

  it("does not invent a cash receipt from a deposit liability record", async () => {
    depositFindMany.mockResolvedValue([
      {
        amountCents: 15000,
        createdAt: new Date("2026-04-01"),
        refundedAt: null,
        refundedAmountCents: null,
        deductionReason: null,
        agreement: { customer: customerRef() },
      },
    ]);
    const rows = await getAccountingTransactions();
    expect(rows).toEqual([]);
  });

  it("exports only the negative cash movement for a refunded deposit", async () => {
    depositFindMany.mockResolvedValue([
      {
        amountCents: 15000,
        createdAt: new Date("2026-04-01"),
        refundedAt: new Date("2026-08-01"),
        refundedAmountCents: 12000,
        deductionReason: "Water damage to floor",
        agreement: { customer: customerRef() },
      },
    ]);
    const rows = await getAccountingTransactions();
    expect(rows).toHaveLength(1);
    const refunded = rows.find((r) => r.type === "Deposit refunded");
    expect(refunded).toMatchObject({
      amountCents: -12000,
      notes: "Water damage to floor",
    });
  });

  it("reconciles deposit-inclusive payment and both refund kinds without counting the deposit twice", async () => {
    paymentFindMany.mockResolvedValue([
      {
        amountCents: 6000,
        method: "card",
        createdAt: new Date("2026-05-01"),
        invoice: { invoiceNumber: 1, customer: customerRef() },
      },
    ]);
    refundFindMany.mockResolvedValue([
      {
        amountCents: 2000,
        reason: "OTHER",
        notes: null,
        createdAt: new Date("2026-05-05"),
        invoice: { invoiceNumber: 1, customer: customerRef() },
      },
    ]);
    depositFindMany.mockResolvedValue([
      {
        amountCents: 1500,
        createdAt: new Date("2026-05-01"),
        refundedAt: new Date("2026-05-06"),
        refundedAmountCents: 1000,
        deductionReason: "Retained damage amount",
        agreement: { customer: customerRef() },
      },
    ]);
    const rows = await getAccountingTransactions();
    expect(rows.map((row) => row.type)).toEqual([
      "Payment",
      "Refund",
      "Deposit refunded",
    ]);
    expect(rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(3000);
    expect(depositFindMany.mock.calls[0][0].where).toEqual({
      refundedAt: { not: null },
    });
  });

  it("sorts every transaction type together, oldest first", async () => {
    paymentFindMany.mockResolvedValue([
      {
        amountCents: 6000,
        method: "card",
        createdAt: new Date("2026-06-01"),
        invoice: {
          invoiceNumber: 1,
          customer: customerRef({ name: "Payment customer" }),
        },
      },
    ]);
    refundFindMany.mockResolvedValue([
      {
        amountCents: 1000,
        reason: "OVERPAYMENT",
        notes: null,
        createdAt: new Date("2026-01-01"),
        invoice: {
          invoiceNumber: 2,
          customer: customerRef({ name: "Refund customer" }),
        },
      },
    ]);
    depositFindMany.mockResolvedValue([
      {
        amountCents: 15000,
        createdAt: new Date("2026-03-01"),
        refundedAt: null,
        refundedAmountCents: null,
        deductionReason: null,
        agreement: { customer: customerRef({ name: "Deposit customer" }) },
      },
    ]);
    const rows = await getAccountingTransactions();
    expect(rows.map((r) => r.customerName)).toEqual([
      "Refund customer",
      "Payment customer",
    ]);
  });

  it("falls back to email when the customer has no name on file", async () => {
    paymentFindMany.mockResolvedValue([
      {
        amountCents: 6000,
        method: "card",
        createdAt: new Date("2026-06-01"),
        invoice: {
          invoiceNumber: 1,
          customer: customerRef({ name: null, email: "noname@example.com" }),
        },
      },
    ]);
    const rows = await getAccountingTransactions();
    expect(rows[0].customerName).toBe("noname@example.com");
  });
});
