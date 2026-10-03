import { describe, it, expect, vi, beforeEach } from "vitest";

// Consolidated statements (Task #72 follow-on, docs/DECISIONS.md
// 2026-09-28) — grouping one customer's invoices by property and rolling
// up totals. See src/domains/billing/statements.ts.

const customerFindUnique = vi.fn();
const customerFindMany = vi.fn();
const invoiceFindMany = vi.fn();
const creditAggregate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: {
      findUnique: (...args: unknown[]) => customerFindUnique(...args),
      findMany: (...args: unknown[]) => customerFindMany(...args),
    },
    invoice: { findMany: (...args: unknown[]) => invoiceFindMany(...args) },
    customerCredit: { aggregate: (...args: unknown[]) => creditAggregate(...args) },
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
    payments: [],
    creditApplications: [],
    refunds: [],
    agreement: { serviceAddress: { id: "addr-1", line1: "1 Main St", line2: null, city: "Greeley", state: "CO", zip: "80631" } },
    ...overrides,
  };
}

describe("getCustomerStatement", () => {
  beforeEach(() => {
    customerFindUnique.mockReset();
    invoiceFindMany.mockReset().mockResolvedValue([]);
    creditAggregate.mockReset().mockResolvedValue({ _sum: { remainingCents: 0 } });
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


describe("statement reconciliation", () => {
  beforeEach(() => {
    customerFindUnique.mockReset();
    invoiceFindMany.mockReset().mockResolvedValue([]);
    creditAggregate.mockReset().mockResolvedValue({ _sum: { remainingCents: 1500 } });
  });

  // One customer with: a paid invoice that was later partly refunded, an unpaid
  // invoice, a partially paid one, one paid with account credit, a written-off
  // one, and a draft and a voided one that must not count.
  function fixture() {
    return {
      id: "cust-1",
      companyName: null,
      user: { name: "Pat", email: "pat@example.com" },
      invoices: [
        invoice({ id: "paid", invoiceNumber: 1, status: "PAID", amountDueCents: 5000, amountPaidCents: 5000,
          payments: [{ amountCents: 5000 }], refunds: [{ amountCents: 1200 }] }),
        invoice({ id: "unpaid", invoiceNumber: 2, status: "OPEN", amountDueCents: 4000, amountPaidCents: 0 }),
        invoice({ id: "partial", invoiceNumber: 3, status: "PARTIALLY_PAID", amountDueCents: 4000, amountPaidCents: 1500,
          payments: [{ amountCents: 1500 }] }),
        invoice({ id: "credit", invoiceNumber: 4, status: "PAID", amountDueCents: 2000, amountPaidCents: 2000,
          creditApplications: [{ amountCents: 2000 }] }),
        invoice({ id: "wo", invoiceNumber: 5, status: "WRITTEN_OFF", amountDueCents: 3000, amountPaidCents: 500,
          payments: [{ amountCents: 500 }] }),
        invoice({ id: "draft", invoiceNumber: 6, status: "DRAFT", amountDueCents: 9999, amountPaidCents: 0 }),
        invoice({ id: "void", invoiceNumber: 7, status: "VOID", amountDueCents: 7777, amountPaidCents: 0 }),
      ],
    };
  }

  it("adds up: billed - payments - credits - written off = balance owed, ignoring drafts and voids", async () => {
    customerFindUnique.mockResolvedValue(fixture());
    const { getCustomerStatement } = await import("@/domains/billing/statements");
    const statement = await getCustomerStatement("cust-1");
    const r = statement!.reconciliation;
    expect(r).toMatchObject({
      carriedForwardCents: 0,
      invoicedCents: 5000 + 4000 + 4000 + 2000 + 3000,
      paymentsAppliedCents: 5000 + 1500 + 500,
      creditsAppliedCents: 2000,
      writtenOffCents: 2500,
      closingBalanceCents: 4000 + 2500,
      balanced: true,
      refundedCents: 1200,
      creditAvailableCents: 1500,
    });
    // The headline totals agree with the footer.
    expect(statement!.totalBalanceCents).toBe(r.closingBalanceCents);
    expect(statement!.totalDueCents).toBe(r.invoicedCents);
  });

  it("does not count a voided, draft or written-off invoice as money owed", async () => {
    customerFindUnique.mockResolvedValue(fixture());
    const { getCustomerStatement } = await import("@/domains/billing/statements");
    const statement = await getCustomerStatement("cust-1");
    const all = statement!.properties.flatMap((p) => p.invoices);
    for (const id of ["draft", "void", "wo", "paid", "credit"]) {
      expect(all.find((i) => i.id === id)!.balanceCents, id).toBe(0);
    }
  });

  it("flags a statement whose paid amount has no matching payment record", async () => {
    const data = fixture();
    data.invoices[0] = invoice({ id: "paid", invoiceNumber: 1, status: "PAID", amountDueCents: 5000, amountPaidCents: 5000, payments: [] });
    customerFindUnique.mockResolvedValue(data);
    const { getCustomerStatement } = await import("@/domains/billing/statements");
    const statement = await getCustomerStatement("cust-1");
    expect(statement!.reconciliation.balanced).toBe(false);
  });

  it("carries forward what is still owed on invoices from before the chosen period", async () => {
    customerFindUnique.mockResolvedValue(fixture());
    invoiceFindMany.mockResolvedValue([{ amountDueCents: 6000, amountPaidCents: 1000 }]);
    const { getCustomerStatement } = await import("@/domains/billing/statements");
    const statement = await getCustomerStatement("cust-1", { periodStart: new Date("2026-09-01") });
    expect(statement!.reconciliation.carriedForwardCents).toBe(5000);
    expect(statement!.reconciliation.closingBalanceCents).toBe(5000 + 4000 + 2500);
    expect(statement!.reconciliation.balanced).toBe(true);
  });
});
