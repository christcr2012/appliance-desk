import { describe, it, expect, vi, beforeEach } from "vitest";

// Consolidated statements (Task #72 follow-on, docs/DECISIONS.md
// 2026-09-28) — grouping one customer's invoices by property and rolling
// up totals. See src/domains/billing/statements.ts.

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

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    invoiceNumber: 1,
    status: "OPEN",
    billingPeriodStart: new Date("2026-09-01"),
    billingPeriodEnd: new Date("2026-10-01"),
    dueDate: new Date("2026-09-05"),
    subtotalCents: 4000,
    discountCents: 0,
    taxCents: 0,
    lateFeeCents: 0,
    amountDueCents: 4000,
    amountPaidCents: 0,
    lineItems: [],
    agreement: { serviceAddress: { id: "addr-1", line1: "1 Main St", line2: null, city: "Greeley", state: "CO", zip: "80631" } },
    ...overrides,
  };
}

describe("getCustomerStatement", () => {
  beforeEach(() => {
    customerFindUnique.mockReset();
  });

  it("returns null for a customer that doesn't exist", async () => {
    customerFindUnique.mockResolvedValue(null);
    const { getCustomerStatement } = await import("@/domains/billing/statements");

    const result = await getCustomerStatement("missing");
    expect(result).toBeNull();
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
          agreement: { serviceAddress: { id: "addr-2", line1: "2 Main St", line2: null, city: "Greeley", state: "CO", zip: "80631" } },
        }),
      ],
    });
    const { getCustomerStatement } = await import("@/domains/billing/statements");

    const result = await getCustomerStatement("cust-1");

    expect(result?.properties).toHaveLength(2);
    expect(result?.properties.map((p) => p.addressLabel)).toEqual([
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

    expect(result?.properties).toHaveLength(1);
    expect(result?.properties[0].addressLabel).toBe("No property on file");
    expect(result?.customerName).toBe("jane@example.com");
  });

  it("computes running totals across properties, and balance as amountDue - amountPaid", async () => {
    customerFindUnique.mockResolvedValue({
      id: "cust-1",
      companyName: null,
      user: { name: "Pat Landlord", email: "pat@example.com" },
      invoices: [
        invoice({ id: "inv-1", invoiceNumber: 1, amountDueCents: 4000, amountPaidCents: 1000 }),
        invoice({
          id: "inv-2",
          invoiceNumber: 2,
          amountDueCents: 5000,
          amountPaidCents: 5000,
          agreement: { serviceAddress: { id: "addr-2", line1: "2 Main St", line2: null, city: "Greeley", state: "CO", zip: "80631" } },
        }),
      ],
    });
    const { getCustomerStatement } = await import("@/domains/billing/statements");

    const result = await getCustomerStatement("cust-1");

    expect(result?.totalDueCents).toBe(9000);
    expect(result?.totalPaidCents).toBe(6000);
    expect(result?.totalBalanceCents).toBe(3000);
    const addr1 = result?.properties.find((p) => p.serviceAddressId === "addr-1");
    expect(addr1?.totalBalanceCents).toBe(3000);
  });

  it("counts only OPEN/PARTIALLY_PAID/DELINQUENT invoices as open", async () => {
    customerFindUnique.mockResolvedValue({
      id: "cust-1",
      companyName: null,
      user: { name: "Pat", email: "pat@example.com" },
      invoices: [
        invoice({ id: "inv-1", status: "PAID" }),
        invoice({ id: "inv-2", status: "DELINQUENT" }),
        invoice({ id: "inv-3", status: "WRITTEN_OFF" }),
      ],
    });
    const { getCustomerStatement } = await import("@/domains/billing/statements");

    const result = await getCustomerStatement("cust-1");
    expect(result?.openInvoiceCount).toBe(1);
  });
});

describe("getCustomersWithOpenBalances", () => {
  beforeEach(() => {
    customerFindMany.mockReset();
  });

  it("sums each customer's open-invoice balance and sorts largest-owed first", async () => {
    customerFindMany.mockResolvedValue([
      {
        id: "cust-1",
        companyName: null,
        isPropertyManager: false,
        user: { name: "Small Balance", email: "a@example.com" },
        invoices: [{ amountDueCents: 1000, amountPaidCents: 0 }],
        _count: { serviceAddresses: 1 },
      },
      {
        id: "cust-2",
        companyName: "Big Portfolio LLC",
        isPropertyManager: true,
        user: { name: "Pat Landlord", email: "pat@example.com" },
        invoices: [
          { amountDueCents: 4000, amountPaidCents: 1000 },
          { amountDueCents: 5000, amountPaidCents: 0 },
        ],
        _count: { serviceAddresses: 3 },
      },
    ]);
    const { getCustomersWithOpenBalances } = await import("@/domains/billing/statements");

    const result = await getCustomersWithOpenBalances();

    expect(result[0].id).toBe("cust-2");
    expect(result[0].balanceCents).toBe(8000);
    expect(result[0].propertyCount).toBe(3);
    expect(result[1].id).toBe("cust-1");
    expect(result[1].balanceCents).toBe(1000);
  });
});
