import { beforeEach, describe, expect, it, vi } from "vitest";

const customerFindUnique = vi.fn();
const customerFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: {
      findUnique: (...args: unknown[]) => customerFindUnique(...args),
      findMany: (...args: unknown[]) => customerFindMany(...args),
    },
  },
}));

function payment(
  amountCents: number,
  receivedOn = new Date("2026-09-10T18:00:00Z"),
  receiptAmountCents = amountCents,
) {
  return {
    amountCents,
    receipt: { receivedOn, amountCents: receiptAmountCents },
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    invoiceNumber: 1,
    status: "OPEN",
    createdAt: new Date("2026-09-01T18:00:00Z"),
    billingPeriodStart: new Date("2026-09-01T06:00:00Z"),
    billingPeriodEnd: new Date("2026-10-01T06:00:00Z"),
    dueDate: new Date("2026-09-05T06:00:00Z"),
    subtotalCents: 4000,
    discountCents: 0,
    taxCents: 0,
    lateFeeCents: 0,
    amountDueCents: 4000,
    amountPaidCents: 0,
    lineItems: [],
    payments: [],
    creditApplications: [],
    refunds: [],
    agreement: {
      serviceAddress: {
        id: "addr-1",
        line1: "1 Main St",
        line2: null,
        city: "Greeley",
        state: "CO",
        zip: "80631",
      },
    },
    ...overrides,
  };
}

describe("getCustomerStatement", () => {
  beforeEach(() => customerFindUnique.mockReset());

  it("returns null for a customer that doesn't exist", async () => {
    customerFindUnique.mockResolvedValue(null);
    const { getCustomerStatement } = await import("@/domains/billing/statements");
    await expect(getCustomerStatement("missing")).resolves.toBeNull();
  });

  it("groups invoices under their property's address", async () => {
    customerFindUnique.mockResolvedValue({
      id: "cust-1",
      companyName: "Pat Properties LLC",
      user: { name: "Pat Landlord", email: "pat@example.com" },
      invoices: [
        invoice({ id: "inv-1", invoiceNumber: 1 }),
        invoice({
          id: "inv-2",
          invoiceNumber: 2,
          agreement: {
            serviceAddress: {
              id: "addr-2",
              line1: "2 Main St",
              line2: null,
              city: "Greeley",
              state: "CO",
              zip: "80631",
            },
          },
        }),
      ],
    });
    const { getCustomerStatement } = await import("@/domains/billing/statements");
    const result = await getCustomerStatement("cust-1");

    expect(result?.properties.map((property) => property.addressLabel)).toEqual([
      "1 Main St, Greeley, CO 80631",
      "2 Main St, Greeley, CO 80631",
    ]);
  });

  it("puts an invoice with no agreement/address under 'No property on file'", async () => {
    customerFindUnique.mockResolvedValue({
      id: "cust-1",
      companyName: null,
      user: { name: null, email: "jane@example.com" },
      invoices: [invoice({ agreement: null })],
    });
    const { getCustomerStatement } = await import("@/domains/billing/statements");
    const result = await getCustomerStatement("cust-1");

    expect(result?.properties[0].addressLabel).toBe("No property on file");
    expect(result?.customerName).toBe("jane@example.com");
  });

  it("derives invoice balances from receipt allocations, credits and refunds", async () => {
    customerFindUnique.mockResolvedValue({
      id: "cust-1",
      companyName: null,
      user: { name: "Pat", email: "pat@example.com" },
      invoices: [
        invoice({
          amountDueCents: 5000,
          amountPaidCents: 9999, // stale projection must not be trusted
          payments: [payment(3000)],
          creditApplications: [
            { amountCents: 500, createdAt: new Date("2026-09-11T18:00:00Z") },
          ],
          refunds: [
            { amountCents: 1000, createdAt: new Date("2026-09-12T18:00:00Z") },
          ],
        }),
      ],
    });
    const { getCustomerStatement } = await import("@/domains/billing/statements");
    const result = await getCustomerStatement("cust-1");

    expect(result?.properties[0].invoices[0]).toMatchObject({
      amountPaidCents: 2500,
      balanceCents: 2500,
    });
  });

  it("reconciles opening + invoices - receipt allocations - credits + refunds = closing, without counting overpayment twice", async () => {
    customerFindUnique.mockResolvedValue({
      id: "cust-1",
      companyName: null,
      user: { name: "Pat Landlord", email: "pat@example.com" },
      invoices: [
        invoice({
          id: "inv-unpaid",
          invoiceNumber: 1,
          amountDueCents: 4000,
          creditApplications: [
            { amountCents: 1000, createdAt: new Date("2026-09-08T18:00:00Z") },
          ],
        }),
        invoice({
          id: "inv-partial",
          invoiceNumber: 2,
          amountDueCents: 5000,
          payments: [payment(3000)],
          refunds: [
            { amountCents: 500, createdAt: new Date("2026-09-15T18:00:00Z") },
          ],
        }),
        invoice({
          id: "inv-overpayment-source",
          invoiceNumber: 3,
          amountDueCents: 2000,
          // Whole receipt was $50; only $20 is allocated here. The $30 excess
          // lives as customer credit and must not be subtracted again yet.
          payments: [payment(2000, new Date("2026-09-20T18:00:00Z"), 5000)],
        }),
      ],
    });
    const { getCustomerStatement } = await import("@/domains/billing/statements");
    const result = await getCustomerStatement("cust-1");

    expect(result?.reconciliation).toEqual({
      openingBalanceCents: 0,
      invoiceChargesCents: 11_000,
      receiptAllocationsCents: 5_000,
      creditsAppliedCents: 1_000,
      refundsCents: 500,
      closingBalanceCents: 5_500,
    });
    expect(result?.totalBalanceCents).toBe(5_500);
  });

  it("moves pre-period ledger events into the opening balance", async () => {
    customerFindUnique.mockResolvedValue({
      id: "cust-1",
      companyName: null,
      user: { name: "Pat", email: "pat@example.com" },
      invoices: [
        invoice({
          createdAt: new Date("2026-08-01T18:00:00Z"),
          billingPeriodStart: new Date("2026-08-01T06:00:00Z"),
          amountDueCents: 4000,
          payments: [payment(1000, new Date("2026-08-10T18:00:00Z"))],
        }),
        invoice({ id: "inv-sep", invoiceNumber: 2, amountDueCents: 2000 }),
      ],
    });
    const { getCustomerStatement } = await import("@/domains/billing/statements");
    const result = await getCustomerStatement("cust-1", {
      periodStart: new Date("2026-09-01T06:00:00Z"),
      periodEnd: new Date("2026-10-01T05:59:59Z"),
    });

    expect(result?.reconciliation.openingBalanceCents).toBe(3000);
    expect(result?.reconciliation.invoiceChargesCents).toBe(2000);
    expect(result?.reconciliation.closingBalanceCents).toBe(5000);
  });
});

describe("getCustomersWithOpenBalances", () => {
  beforeEach(() => customerFindMany.mockReset());

  it("uses ledger events for balance, filters paid-up customers and sorts largest owed first", async () => {
    customerFindMany.mockResolvedValue([
      {
        id: "cust-1",
        companyName: null,
        isPropertyManager: false,
        user: { name: "Small Balance", email: "a@example.com" },
        invoices: [
          {
            amountDueCents: 1000,
            payments: [],
            creditApplications: [],
            refunds: [],
          },
        ],
        _count: { serviceAddresses: 1 },
      },
      {
        id: "cust-2",
        companyName: "Big Portfolio LLC",
        isPropertyManager: true,
        user: { name: "Pat Landlord", email: "pat@example.com" },
        invoices: [
          {
            amountDueCents: 4000,
            payments: [payment(1000)],
            creditApplications: [],
            refunds: [],
          },
          {
            amountDueCents: 5000,
            payments: [],
            creditApplications: [],
            refunds: [],
          },
        ],
        _count: { serviceAddresses: 3 },
      },
      {
        id: "cust-paid",
        companyName: null,
        isPropertyManager: false,
        user: { name: "Paid Up", email: "paid@example.com" },
        invoices: [
          {
            amountDueCents: 2000,
            payments: [payment(2000)],
            creditApplications: [],
            refunds: [],
          },
        ],
        _count: { serviceAddresses: 1 },
      },
    ]);
    const { getCustomersWithOpenBalances } = await import("@/domains/billing/statements");
    const result = await getCustomersWithOpenBalances();

    expect(result.map((row) => row.id)).toEqual(["cust-2", "cust-1"]);
    expect(result[0]).toMatchObject({
      balanceCents: 8000,
      propertyCount: 3,
      openInvoiceCount: 2,
    });
  });
});
