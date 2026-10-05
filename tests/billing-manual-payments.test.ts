import { beforeEach, describe, expect, it, vi } from "vitest";

const ledger = vi.hoisted(() => ({
  lockCustomerLedger: vi.fn(),
  createReceiptWithAllocations: vi.fn(),
}));
const invoiceFindMany = vi.fn();
const invoiceUpdate = vi.fn();
const auditLogCreate = vi.fn();
const queryRaw = vi.fn();

vi.mock("@/domains/billing/ledger", () => ledger);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        $queryRaw: (...args: unknown[]) => queryRaw(...args),
        invoice: {
          findMany: (...args: unknown[]) => invoiceFindMany(...args),
          update: invoiceUpdate,
        },
        auditLog: { create: auditLogCreate },
      }),
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
    vi.clearAllMocks();
    ledger.lockCustomerLedger.mockResolvedValue(undefined);
    ledger.createReceiptWithAllocations.mockResolvedValue({
      receiptId: "receipt-1",
      overpaymentCreditId: null,
    });
    invoiceFindMany.mockReset();
    auditLogCreate.mockResolvedValue({});
  });

  it("refuses a zero or negative amount", async () => {
    const { recordManualPayment } = await import("@/domains/billing/manual-payments");
    await expect(
      recordManualPayment("cust-1", "owner-1", { amountCents: 0, method: "check" }),
    ).rejects.toThrow(/greater than \$0/i);
    expect(ledger.lockCustomerLedger).not.toHaveBeenCalled();
  });

  it("spreads one real payment across several invoices but creates one receipt", async () => {
    invoiceFindMany.mockResolvedValue([
      openInvoice({ id: "inv-old", invoiceNumber: 11, amountDueCents: 3000 }),
      openInvoice({ id: "inv-new", invoiceNumber: 12, amountDueCents: 5000 }),
    ]);
    const receivedOn = new Date("2026-10-01T06:00:00Z");
    const { recordManualPayment } = await import("@/domains/billing/manual-payments");

    const result = await recordManualPayment("cust-1", "owner-1", {
      amountCents: 4000,
      method: "bank_transfer",
      receivedOn,
      reference: "ACH-44",
    });

    expect(ledger.createReceiptWithAllocations).toHaveBeenCalledOnce();
    expect(ledger.createReceiptWithAllocations.mock.calls[0][1]).toMatchObject({
      customerId: "cust-1",
      source: "MANUAL",
      amountCents: 4000,
      method: "bank_transfer",
      receivedOn,
      recordedByUserId: "owner-1",
      notes: "Ref: ACH-44",
      allocations: [
        { invoiceId: "inv-old", amountCents: 3000 },
        { invoiceId: "inv-new", amountCents: 1000 },
      ],
    });
    expect(result).toMatchObject({ totalAppliedCents: 4000, overpaymentCents: 0 });
    expect(result.invoicesTouched).toHaveLength(2);
    expect(auditLogCreate).toHaveBeenCalledTimes(2);
  });

  it("reports the remainder as overpayment while the ledger mints the credit", async () => {
    invoiceFindMany.mockResolvedValue([openInvoice({ amountDueCents: 3000 })]);
    ledger.createReceiptWithAllocations.mockResolvedValue({
      receiptId: "receipt-2",
      overpaymentCreditId: "credit-1",
    });
    const { recordManualPayment } = await import("@/domains/billing/manual-payments");

    const result = await recordManualPayment("cust-1", "owner-1", {
      amountCents: 5000,
      method: "check",
    });

    expect(ledger.createReceiptWithAllocations.mock.calls[0][1]).toMatchObject({
      amountCents: 5000,
      allocations: [{ invoiceId: "inv-1", amountCents: 3000 }],
    });
    expect(result.overpaymentCents).toBe(2000);
    expect(result.totalAppliedCents).toBe(3000);
  });

  it("uses the explicitly entered received date instead of record time", async () => {
    invoiceFindMany.mockResolvedValue([openInvoice()]);
    const receivedOn = new Date("2026-09-15T06:00:00Z");
    const { recordManualPayment } = await import("@/domains/billing/manual-payments");
    await recordManualPayment("cust-1", "owner-1", {
      amountCents: 1000,
      method: "cash",
      receivedOn,
    });
    expect(ledger.createReceiptWithAllocations.mock.calls[0][1].receivedOn).toBe(receivedOn);
  });

  it("applies only to the named open invoice when invoiceId is given", async () => {
    invoiceFindMany.mockResolvedValue([openInvoice({ id: "inv-target" })]);
    const { recordManualPayment } = await import("@/domains/billing/manual-payments");
    await recordManualPayment("cust-1", "owner-1", {
      amountCents: 2000,
      method: "check",
      invoiceId: "inv-target",
    });
    expect(invoiceFindMany).toHaveBeenCalledWith({
      where: {
        id: "inv-target",
        customerId: "cust-1",
        status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
  });

  it("refuses a named invoice that is not open for this customer", async () => {
    invoiceFindMany.mockResolvedValue([]);
    const { recordManualPayment } = await import("@/domains/billing/manual-payments");
    await expect(
      recordManualPayment("cust-1", "owner-1", {
        amountCents: 1000,
        method: "check",
        invoiceId: "not-open",
      }),
    ).rejects.toThrow(/isn't open/i);
    expect(ledger.createReceiptWithAllocations).not.toHaveBeenCalled();
  });
});

describe("writeOffInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryRaw.mockReset();
    invoiceUpdate.mockResolvedValue({});
    auditLogCreate.mockResolvedValue({});
  });

  it("marks an invoice WRITTEN_OFF with a reason", async () => {
    queryRaw.mockResolvedValueOnce([
      { id: "inv-1", status: "DELINQUENT", amountDueCents: 4000, amountPaidCents: 500 },
    ]);
    const { writeOffInvoice } = await import("@/domains/billing/manual-payments");
    await writeOffInvoice("inv-1", "owner-1", "Tenant vacated, uncollectible");
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: expect.objectContaining({
        status: "WRITTEN_OFF",
        writtenOffReason: "Tenant vacated, uncollectible",
      }),
    });
  });

  it("refuses an invoice that's already fully paid", async () => {
    queryRaw.mockResolvedValueOnce([
      { id: "inv-1", status: "PAID", amountDueCents: 4000, amountPaidCents: 4000 },
    ]);
    const { writeOffInvoice } = await import("@/domains/billing/manual-payments");
    await expect(writeOffInvoice("inv-1", "owner-1", "reason")).rejects.toThrow(/already fully paid/i);
  });

  it("refuses an invoice that's already written off", async () => {
    queryRaw.mockResolvedValueOnce([
      { id: "inv-1", status: "WRITTEN_OFF", amountDueCents: 4000, amountPaidCents: 0 },
    ]);
    const { writeOffInvoice } = await import("@/domains/billing/manual-payments");
    await expect(writeOffInvoice("inv-1", "owner-1", "reason")).rejects.toThrow(/already written off/i);
  });

  it("refuses an invoice that doesn't exist", async () => {
    queryRaw.mockResolvedValueOnce([]);
    const { writeOffInvoice } = await import("@/domains/billing/manual-payments");
    await expect(writeOffInvoice("missing", "owner-1", "reason")).rejects.toThrow(/couldn't find that invoice/i);
  });
});