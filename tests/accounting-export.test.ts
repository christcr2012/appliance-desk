import { beforeEach, describe, expect, it, vi } from "vitest";

const transaction = vi.fn();
const receiptFindMany = vi.fn();
const refundFindMany = vi.fn();
const depositFindMany = vi.fn();
const creditFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => transaction(...args),
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
      name: "name" in overrides ? overrides.name : "Jane Doe",
      email: overrides.email ?? "jane@example.com",
    },
  };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    id: "receipt-1",
    source: "STRIPE",
    amountCents: 6000,
    method: "card",
    notes: null,
    receivedOn: new Date("2026-05-01"),
    customer: customerRef(),
    payments: [{ invoice: { invoiceNumber: 101 } }],
    ...overrides,
  };
}

describe("getAccountingTransactions", () => {
  beforeEach(() => {
    transaction.mockReset().mockImplementation((callback) =>
      callback({
        receipt: { findMany: (...args: unknown[]) => receiptFindMany(...args) },
        refund: { findMany: (...args: unknown[]) => refundFindMany(...args) },
        deposit: { findMany: (...args: unknown[]) => depositFindMany(...args) },
        customerCredit: { findMany: (...args: unknown[]) => creditFindMany(...args) },
      }),
    );
    receiptFindMany.mockReset().mockResolvedValue([]);
    refundFindMany.mockReset().mockResolvedValue([]);
    depositFindMany.mockReset().mockResolvedValue([]);
    creditFindMany.mockReset().mockResolvedValue([]);
  });

  it("exports receipts as the incoming-cash source of truth", async () => {
    receiptFindMany.mockResolvedValue([receipt()]);
    const rows = await getAccountingTransactions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "Payment",
      amountCents: 6000,
      invoiceNumber: 101,
      date: new Date("2026-05-01"),
    });
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
  });

  it("uses one row for a combined receipt and does not pretend one invoice owns it", async () => {
    receiptFindMany.mockResolvedValue([
      receipt({
        amountCents: 25_000,
        method: "check",
        payments: [
          { invoice: { invoiceNumber: 101 } },
          { invoice: { invoiceNumber: 102 } },
          { invoice: { invoiceNumber: 103 } },
        ],
      }),
    ]);
    const rows = await getAccountingTransactions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "Payment",
      amountCents: 25_000,
      invoiceNumber: null,
      methodOrReason: "check",
    });
  });

  it("uses the receipt's receivedOn rather than application-created timestamps", async () => {
    receiptFindMany.mockResolvedValue([
      receipt({ receivedOn: new Date("2026-04-15T06:00:00Z") }),
    ]);
    const rows = await getAccountingTransactions();
    expect(rows[0]?.date).toEqual(new Date("2026-04-15T06:00:00Z"));
  });

  it("includes a refund as a negative amount", async () => {
    refundFindMany.mockResolvedValue([
      {
        id: "refund-1",
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

  it("traces each row to its ledger record and says where a payment came from", async () => {
    receiptFindMany.mockResolvedValue([receipt({ id: "rcpt-9", source: "MANUAL", method: "check" })]);
    refundFindMany.mockResolvedValue([
      {
        id: "ref-9",
        amountCents: 500,
        reason: "GOODWILL",
        notes: null,
        createdAt: new Date("2026-05-09"),
        invoice: { invoiceNumber: 9, customer: customerRef() },
      },
    ]);
    const rows = await getAccountingTransactions();
    expect(rows.find((r) => r.type === "Payment")).toMatchObject({ recordId: "rcpt-9", source: "MANUAL" });
    expect(rows.find((r) => r.type === "Refund")).toMatchObject({ recordId: "ref-9", source: "" });
  });

  it("labels a refund kept as account credit so it is not mistaken for cash returned", async () => {
    refundFindMany.mockResolvedValue([
      {
        id: "ref-credit",
        amountCents: 4000,
        reason: "BILLING_ERROR",
        notes: null,
        createdAt: new Date("2026-05-09"),
        invoice: { invoiceNumber: 4, customer: customerRef() },
      },
    ]);
    creditFindMany.mockResolvedValue([{ sourceId: "ref-credit" }]);
    const rows = await getAccountingTransactions();
    expect(rows[0]).toMatchObject({ type: "Refund to account credit", amountCents: -4000 });
  });

  it("exports only the negative cash movement for a refunded deposit", async () => {
    depositFindMany.mockResolvedValue([
      {
        refundedAt: new Date("2026-08-01"),
        refundedAmountCents: 12000,
        deductionReason: "Water damage to floor",
        agreement: { customer: customerRef() },
      },
    ]);
    const rows = await getAccountingTransactions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "Deposit refunded",
      amountCents: -12000,
      notes: "Water damage to floor",
    });
  });

  it("reconciles incoming receipt and both refund kinds without counting deposit liability twice", async () => {
    receiptFindMany.mockResolvedValue([
      receipt({ amountCents: 6000, payments: [{ invoice: { invoiceNumber: 1 } }] }),
    ]);
    refundFindMany.mockResolvedValue([
      {
        id: "refund-2",
        amountCents: 2000,
        reason: "OTHER",
        notes: null,
        createdAt: new Date("2026-05-05"),
        invoice: { invoiceNumber: 1, customer: customerRef() },
      },
    ]);
    depositFindMany.mockResolvedValue([
      {
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
  });

  it("sorts every transaction type together, oldest first", async () => {
    receiptFindMany.mockResolvedValue([
      receipt({
        receivedOn: new Date("2026-06-01"),
        customer: customerRef({ name: "Payment customer" }),
      }),
    ]);
    refundFindMany.mockResolvedValue([
      {
        id: "refund-3",
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
    const rows = await getAccountingTransactions();
    expect(rows.map((row) => row.customerName)).toEqual([
      "Refund customer",
      "Payment customer",
    ]);
  });

  it("falls back to email when the customer has no name on file", async () => {
    receiptFindMany.mockResolvedValue([
      receipt({ customer: customerRef({ name: null, email: "noname@example.com" }) }),
    ]);
    const rows = await getAccountingTransactions();
    expect(rows[0]?.customerName).toBe("noname@example.com");
  });
});
