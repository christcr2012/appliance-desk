import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceStatus } from "@prisma/client";
import {
  applyCreditToInvoice,
  createReceiptWithAllocations,
} from "@/domains/billing/ledger";

type StoredInvoice = {
  id: string;
  customerId: string;
  status: InvoiceStatus;
  amountDueCents: number;
  amountPaidCents: number;
};

const invoices = new Map<string, StoredInvoice>();
const receipts: Array<Record<string, unknown>> = [];
const payments: Array<Record<string, unknown>> = [];
const credits: Array<Record<string, unknown>> = [];
let customerExists = true;

function tx() {
  return {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      const id = String(values[0] ?? "");
      if (sql.includes('FROM "Customer"')) {
        return customerExists && id === "cust-1" ? [{ id }] : [];
      }
      if (sql.includes('FROM "Invoice"')) {
        const invoice = invoices.get(id);
        return invoice ? [{ ...invoice }] : [];
      }
      if (sql.includes('FROM "Deposit"')) return [];
      throw new Error(`Unexpected query: ${sql}`);
    },
    receipt: {
      findUnique: vi.fn(async ({ where }: { where: { stripeChargeId: string } }) => {
        const found = receipts.find((receipt) => receipt.stripeChargeId === where.stripeChargeId);
        if (!found) return null;
        return {
          id: found.id,
          customerId: found.customerId,
          source: found.source,
          amountCents: found.amountCents,
          payments: payments
            .filter((payment) => payment.receiptId === found.id)
            .map((payment) => ({ invoiceId: payment.invoiceId, amountCents: payment.amountCents })),
        };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `receipt-${receipts.length + 1}`, ...data };
        receipts.push(row);
        return { id: row.id };
      }),
    },
    payment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        payments.push({ id: `payment-${payments.length + 1}`, ...data });
        return {};
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    invoice: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<StoredInvoice> }) => {
        const current = invoices.get(where.id)!;
        invoices.set(where.id, { ...current, ...data });
        return invoices.get(where.id);
      }),
    },
    customerCredit: {
      findFirst: vi.fn(async ({ where }: { where: { sourceId: string } }) => {
        const row = credits.find((credit) => credit.sourceId === where.sourceId);
        return row ? { id: row.id } : null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `credit-${credits.length + 1}`, ...data };
        credits.push(row);
        return { id: row.id };
      }),
    },
  } as never;
}

function invoice(id: string, amountDueCents: number): StoredInvoice {
  return {
    id,
    customerId: "cust-1",
    status: "OPEN",
    amountDueCents,
    amountPaidCents: 0,
  };
}

describe("createReceiptWithAllocations", () => {
  beforeEach(() => {
    invoices.clear();
    receipts.length = 0;
    payments.length = 0;
    credits.length = 0;
    customerExists = true;
    invoices.set("inv-a", invoice("inv-a", 10_000));
    invoices.set("inv-b", invoice("inv-b", 8_000));
    invoices.set("inv-c", invoice("inv-c", 7_000));
  });

  it("records one receipt with several invoice allocations", async () => {
    const result = await createReceiptWithAllocations(tx(), {
      customerId: "cust-1",
      source: "MANUAL",
      amountCents: 25_000,
      method: "check",
      receivedOn: new Date("2026-10-02T06:00:00Z"),
      recordedByUserId: "owner-1",
      allocations: [
        { invoiceId: "inv-a", amountCents: 10_000 },
        { invoiceId: "inv-b", amountCents: 8_000 },
        { invoiceId: "inv-c", amountCents: 7_000 },
      ],
    });

    expect(receipts).toHaveLength(1);
    expect(payments).toHaveLength(3);
    expect(new Set(payments.map((payment) => payment.receiptId))).toEqual(new Set([result.receiptId]));
    expect(payments.reduce((sum, payment) => sum + Number(payment.amountCents), 0)).toBe(25_000);
    expect(credits).toHaveLength(0);
    expect(result.overpaymentCreditId).toBeNull();
    expect([...invoices.values()].every((stored) => stored.status === "PAID")).toBe(true);
  });

  it("turns only the unallocated remainder into a provenance-linked credit", async () => {
    const result = await createReceiptWithAllocations(tx(), {
      customerId: "cust-1",
      source: "MANUAL",
      amountCents: 40_000,
      method: "check",
      receivedOn: new Date("2026-10-02T06:00:00Z"),
      allocations: [
        { invoiceId: "inv-a", amountCents: 10_000 },
        { invoiceId: "inv-b", amountCents: 8_000 },
        { invoiceId: "inv-c", amountCents: 7_000 },
      ],
    });

    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({
      amountCents: 15_000,
      remainingCents: 15_000,
      sourceType: "RECEIPT_OVERPAYMENT",
      sourceId: result.receiptId,
      side: null,
    });
    expect(result.overpaymentCreditId).toBe(credits[0]?.id);
  });

  it("treats the same Stripe charge as the same receipt instead of minting money twice", async () => {
    const first = await createReceiptWithAllocations(tx(), {
      customerId: "cust-1",
      source: "STRIPE",
      amountCents: 10_000,
      method: "card",
      stripeChargeId: "ch_same",
      receivedOn: new Date("2026-10-02T18:00:00Z"),
      allocations: [{ invoiceId: "inv-a", amountCents: 10_000 }],
    });

    const second = await createReceiptWithAllocations(tx(), {
      customerId: "cust-1",
      source: "STRIPE",
      amountCents: 10_000,
      method: "card",
      stripeChargeId: "ch_same",
      receivedOn: new Date("2026-10-02T18:00:00Z"),
      allocations: [{ invoiceId: "inv-a", amountCents: 10_000 }],
    });

    expect(second.receiptId).toBe(first.receiptId);
    expect(receipts).toHaveLength(1);
    expect(payments).toHaveLength(1);
  });

  it("rejects an allocation that would overpay an invoice projection", async () => {
    await expect(
      createReceiptWithAllocations(tx(), {
        customerId: "cust-1",
        source: "MANUAL",
        amountCents: 12_000,
        method: "cash",
        receivedOn: new Date("2026-10-02T06:00:00Z"),
        allocations: [{ invoiceId: "inv-a", amountCents: 12_000 }],
      }),
    ).rejects.toThrow(/outstanding balance/i);
    expect(receipts).toHaveLength(0);
  });

  it("refuses cross-customer allocation", async () => {
    invoices.set("inv-a", { ...invoice("inv-a", 10_000), customerId: "cust-2" });
    await expect(
      createReceiptWithAllocations(tx(), {
        customerId: "cust-1",
        source: "MANUAL",
        amountCents: 1_000,
        method: "cash",
        receivedOn: new Date("2026-10-02T06:00:00Z"),
        allocations: [{ invoiceId: "inv-a", amountCents: 1_000 }],
      }),
    ).rejects.toThrow(/another customer's invoice/i);
  });
});

describe("applyCreditToInvoice", () => {
  type CreditState = {
    id: string;
    customerId: string;
    remainingCents: number;
    appliedViaStripeAt: Date | null;
    reason: string;
  };
  type InvoiceState = StoredInvoice & { version: number };

  function creditTx(options?: {
    credit?: Partial<CreditState>;
    invoice?: Partial<InvoiceState>;
    providerReserved?: boolean;
  }) {
    const credit: CreditState = {
      id: "credit-1",
      customerId: "cust-1",
      remainingCents: 5_000,
      appliedViaStripeAt: null,
      reason: "Referral reward",
      ...options?.credit,
    };
    const invoiceState: InvoiceState = {
      ...invoice("inv-1", 10_000),
      version: 1,
      ...options?.invoice,
    };
    const applications: Array<Record<string, unknown>> = [];
    const lineItems: Array<Record<string, unknown>> = [];

    const fake = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join("?");
        if (sql.includes('FROM "CustomerCredit"')) return [{ ...credit }];
        if (sql.includes('FROM "Invoice"')) return [{ ...invoiceState }];
        throw new Error(`Unexpected query: ${sql}`);
      },
      providerOperation: {
        findFirst: vi.fn(async () =>
          options?.providerReserved ? { id: "provider-op-1", status: "PENDING" } : null,
        ),
      },
      creditApplication: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          applications.push(data);
          return {};
        }),
      },
      invoiceLineItem: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          lineItems.push(data);
          return {};
        }),
      },
      customerCredit: {
        update: vi.fn(async ({ data }: { data: { remainingCents: { decrement: number } } }) => {
          credit.remainingCents -= data.remainingCents.decrement;
          return { ...credit };
        }),
      },
      invoice: {
        update: vi.fn(async ({ data }: {
          data: {
            amountPaidCents: number;
            status: InvoiceStatus;
            version: { increment: number };
          };
        }) => {
          invoiceState.amountPaidCents = data.amountPaidCents;
          invoiceState.status = data.status;
          invoiceState.version += data.version.increment;
          return { ...invoiceState };
        }),
      },
    } as never;

    return { fake, credit, invoiceState, applications, lineItems };
  }

  it("applies a local credit atomically and records its provenance on the invoice", async () => {
    const state = creditTx();

    await applyCreditToInvoice(state.fake, {
      creditId: "credit-1",
      invoiceId: "inv-1",
      amountCents: 5_000,
      appliedByUserId: "owner-1",
    });

    expect(state.credit.remainingCents).toBe(0);
    expect(state.invoiceState.amountPaidCents).toBe(5_000);
    expect(state.invoiceState.status).toBe("PARTIALLY_PAID");
    expect(state.invoiceState.version).toBe(2);
    expect(state.applications).toEqual([
      {
        creditId: "credit-1",
        invoiceId: "inv-1",
        amountCents: 5_000,
        appliedByUserId: "owner-1",
      },
    ]);
    expect(state.lineItems).toEqual([
      expect.objectContaining({
        invoiceId: "inv-1",
        kind: "CREDIT",
        amountCents: -5_000,
      }),
    ]);
  });

  it("rejects a credit as soon as provider settlement has reserved it", async () => {
    const state = creditTx({ providerReserved: true });
    await expect(
      applyCreditToInvoice(state.fake, {
        creditId: "credit-1",
        invoiceId: "inv-1",
        amountCents: 1_000,
        appliedByUserId: "owner-1",
      }),
    ).rejects.toThrow(/reserved for Stripe settlement/i);
    expect(state.applications).toHaveLength(0);
  });

  it("rejects spending more than the credit has remaining", async () => {
    const state = creditTx({ credit: { remainingCents: 1_000 } });
    await expect(
      applyCreditToInvoice(state.fake, {
        creditId: "credit-1",
        invoiceId: "inv-1",
        amountCents: 1_001,
        appliedByUserId: "owner-1",
      }),
    ).rejects.toThrow(/enough remaining balance/i);
    expect(state.applications).toHaveLength(0);
  });

  it("rejects applying a credit to an already-paid invoice", async () => {
    const state = creditTx({
      invoice: { status: "PAID", amountPaidCents: 10_000 },
    });
    await expect(
      applyCreditToInvoice(state.fake, {
        creditId: "credit-1",
        invoiceId: "inv-1",
        amountCents: 1_000,
        appliedByUserId: "owner-1",
      }),
    ).rejects.toThrow(/open invoice/i);
  });

  it("rejects a referral credit that has already been pushed to Stripe", async () => {
    const state = creditTx({ credit: { appliedViaStripeAt: new Date() } });
    await expect(
      applyCreditToInvoice(state.fake, {
        creditId: "credit-1",
        invoiceId: "inv-1",
        amountCents: 1_000,
        appliedByUserId: "owner-1",
      }),
    ).rejects.toThrow(/already applied through Stripe/i);
    expect(state.applications).toHaveLength(0);
  });

  it("rejects applying one customer's credit to another customer's invoice", async () => {
    const state = creditTx({ invoice: { customerId: "cust-2" } });
    await expect(
      applyCreditToInvoice(state.fake, {
        creditId: "credit-1",
        invoiceId: "inv-1",
        amountCents: 1_000,
        appliedByUserId: "owner-1",
      }),
    ).rejects.toThrow(/another customer's invoice/i);
  });
});
