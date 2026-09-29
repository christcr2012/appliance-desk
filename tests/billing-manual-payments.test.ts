import { describe, it, expect, vi, beforeEach } from "vitest";

// Manual (offline) payments (Task #72 follow-on, docs/DECISIONS.md
// 2026-09-28) — money that moved outside Stripe, recorded and applied by
// hand. See src/domains/billing/manual-payments.ts.

const customerFindUnique = vi.fn();
const invoiceFindMany = vi.fn();
const invoiceFindUnique = vi.fn();
const paymentCreate = vi.fn();
const invoiceUpdate = vi.fn();
const auditLogCreate = vi.fn();
const customerCreditCreate = vi.fn();

function makeTx() {
  return {
    payment: { create: paymentCreate },
    invoice: { update: invoiceUpdate },
    auditLog: { create: auditLogCreate },
    customerCredit: { create: customerCreditCreate },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: {
      findUnique: (...args: unknown[]) => customerFindUnique(...args),
    },
    invoice: {
      findMany: (...args: unknown[]) => invoiceFindMany(...args),
      findUnique: (...args: unknown[]) => invoiceFindUnique(...args),
      update: (...args: unknown[]) => invoiceUpdate(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => auditLogCreate(...args),
    },
    // recordManualPayment uses the callback form ($transaction(async (tx) =>
    // ...)); writeOffInvoice uses the array form ($transaction([...])),
    // which runs each promise through the top-level mocks above instead of
    // tx. Support both shapes here.
    $transaction: (arg: ((tx: unknown) => unknown) | Promise<unknown>[]) =>
      typeof arg === "function" ? arg(makeTx()) : Promise.all(arg),
  },
}));

function openInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    invoiceNumber: 1,
    customerId: "cust-1",
    status: "OPEN",
    amountDueCents: 4000,
    amountPaidCents: 0,
    dueDate: new Date("2026-09-01"),
    createdAt: new Date("2026-09-01"),
    ...overrides,
  };
}

describe("recordManualPayment", () => {
  beforeEach(() => {
    customerFindUnique.mockReset().mockResolvedValue({ id: "cust-1" });
    invoiceFindMany.mockReset();
    paymentCreate.mockReset().mockResolvedValue({});
    invoiceUpdate.mockReset().mockResolvedValue({});
    auditLogCreate.mockReset().mockResolvedValue({});
    customerCreditCreate.mockReset().mockResolvedValue({});
  });

  it("refuses a zero or negative amount", async () => {
    const { recordManualPayment } = await import("@/domains/billing/manual-payments");
    await expect(
      recordManualPayment("cust-1", "owner-1", { amountCents: 0, method: "check" }),
    ).rejects.toThrow(/greater than \$0/i);
    expect(invoiceFindMany).not.toHaveBeenCalled();
  });

  it("refuses a customer that doesn't exist", async () => {
    customerFindUnique.mockResolvedValue(null);
    const { recordManualPayment } = await import("@/domains/billing/manual-payments");
    await expect(
      recordManualPayment("missing", "owner-1", { amountCents: 1000, method: "check" }),
    ).rejects.toThrow(/couldn't find that customer/i);
  });

  it("applies a payment to a single invoice fully, marking it PAID", async () => {
    invoiceFindMany.mockResolvedValue([openInvoice({ amountDueCents: 4000 })]);
    const { recordManualPayment } = await import("@/domains/billing/manual-payments");

    const result = await recordManualPayment("cust-1", "owner-1", {
      amountCents: 4000,
      method: "check",
      reference: "1234",
    });

    expect(paymentCreate).toHaveBeenCalledTimes(1);
    expect(paymentCreate.mock.calls[0][0].data).toMatchObject({
      invoiceId: "inv-1",
      amountCents: 4000,
      method: "check",
      status: "succeeded",
      recordedByUserId: "owner-1",
      notes: "Ref: 1234",
    });
    expect(invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { amountPaidCents: 4000, status: "PAID" },
    });
    expect(result.totalAppliedCents).toBe(4000);
    expect(result.overpaymentCents).toBe(0);
    expect(result.invoicesTouched).toHaveLength(1);
  });

  it("partially pays an invoice, marking it PARTIALLY_PAID", async () => {
    invoiceFindMany.mockResolvedValue([openInvoice({ amountDueCents: 4000 })]);
    const { recordManualPayment } = await import("@/domains/billing/manual-payments");

    await recordManualPayment("cust-1", "owner-1", { amountCents: 1500, method: "cash" });

    expect(invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { amountPaidCents: 1500, status: "PARTIALLY_PAID" },
    });
  });

  it("spreads one payment across several invoices, oldest-due-first, when no invoiceId is given", async () => {
    invoiceFindMany.mockResolvedValue([
      openInvoice({ id: "inv-old", amountDueCents: 3000, dueDate: new Date("2026-08-01") }),
      openInvoice({ id: "inv-new", amountDueCents: 5000, dueDate: new Date("2026-09-01") }),
    ]);
    const { recordManualPayment } = await import("@/domains/billing/manual-payments");

    const result = await recordManualPayment("cust-1", "owner-1", {
      amountCents: 4000,
      method: "bank_transfer",
    });

    // First (oldest) invoice paid in full (3000), remainder (1000) to the next.
    expect(paymentCreate).toHaveBeenCalledTimes(2);
    expect(paymentCreate.mock.calls[0][0].data).toMatchObject({ invoiceId: "inv-old", amountCents: 3000 });
    expect(paymentCreate.mock.calls[1][0].data).toMatchObject({ invoiceId: "inv-new", amountCents: 1000 });
    expect(result.invoicesTouched).toHaveLength(2);
    expect(result.overpaymentCents).toBe(0);
  });

  it("creates a CustomerCredit for any amount left over once every invoice is paid in full", async () => {
    invoiceFindMany.mockResolvedValue([openInvoice({ amountDueCents: 3000 })]);
    const { recordManualPayment } = await import("@/domains/billing/manual-payments");

    const result = await recordManualPayment("cust-1", "owner-1", { amountCents: 5000, method: "check" });

    expect(customerCreditCreate).toHaveBeenCalledTimes(1);
    expect(customerCreditCreate.mock.calls[0][0].data).toMatchObject({
      customerId: "cust-1",
      amountCents: 2000,
      remainingCents: 2000,
      reason: "Overpayment",
    });
    expect(result.overpaymentCents).toBe(2000);
    expect(result.totalAppliedCents).toBe(3000);
  });

  it("applies the whole amount to one named invoice when invoiceId is given, ignoring others", async () => {
    invoiceFindMany.mockResolvedValue([openInvoice({ id: "inv-target", amountDueCents: 4000 })]);
    const { recordManualPayment } = await import("@/domains/billing/manual-payments");

    await recordManualPayment("cust-1", "owner-1", {
      amountCents: 2000,
      method: "check",
      invoiceId: "inv-target",
    });

    expect(invoiceFindMany).toHaveBeenCalledWith({
      where: { id: "inv-target", customerId: "cust-1" },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    });
  });

  it("refuses an invoiceId that doesn't belong to this customer", async () => {
    invoiceFindMany.mockResolvedValue([]);
    const { recordManualPayment } = await import("@/domains/billing/manual-payments");

    await expect(
      recordManualPayment("cust-1", "owner-1", {
        amountCents: 1000,
        method: "check",
        invoiceId: "someone-elses-invoice",
      }),
    ).rejects.toThrow(/doesn't belong to this customer/i);
  });
});

describe("writeOffInvoice", () => {
  beforeEach(() => {
    invoiceFindUnique.mockReset();
    invoiceUpdate.mockReset().mockResolvedValue({});
    auditLogCreate.mockReset().mockResolvedValue({});
  });

  it("marks an invoice WRITTEN_OFF with a reason", async () => {
    invoiceFindUnique.mockResolvedValue({ id: "inv-1", status: "DELINQUENT" });
    const { writeOffInvoice } = await import("@/domains/billing/manual-payments");

    await writeOffInvoice("inv-1", "owner-1", "Tenant vacated, uncollectible");

    expect(invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: expect.objectContaining({ status: "WRITTEN_OFF", writtenOffReason: "Tenant vacated, uncollectible" }),
    });
    expect(auditLogCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses an invoice that's already fully paid", async () => {
    invoiceFindUnique.mockResolvedValue({ id: "inv-1", status: "PAID" });
    const { writeOffInvoice } = await import("@/domains/billing/manual-payments");

    await expect(writeOffInvoice("inv-1", "owner-1", "reason")).rejects.toThrow(/already fully paid/i);
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it("refuses an invoice that's already written off", async () => {
    invoiceFindUnique.mockResolvedValue({ id: "inv-1", status: "WRITTEN_OFF" });
    const { writeOffInvoice } = await import("@/domains/billing/manual-payments");

    await expect(writeOffInvoice("inv-1", "owner-1", "reason")).rejects.toThrow(/already written off/i);
  });

  it("refuses an invoice that doesn't exist", async () => {
    invoiceFindUnique.mockResolvedValue(null);
    const { writeOffInvoice } = await import("@/domains/billing/manual-payments");

    await expect(writeOffInvoice("missing", "owner-1", "reason")).rejects.toThrow(/couldn't find that invoice/i);
  });
});
