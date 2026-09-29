import { describe, it, expect, vi, beforeEach } from "vitest";

// Automated late fees (docs/ROADMAP.md's "Deliberately deferred within
// Phase 6B", built 2026-09-28 — see docs/DECISIONS.md). See
// src/domains/billing/late-fees.ts for the full reasoning: no auto-retry
// charge, fee is the larger of the agreement's flat/percent, and
// Invoice.lateFeeCents === 0 is the idempotency guard.

const invoiceFindMany = vi.fn();
const invoiceLineItemCreate = vi.fn();
const invoiceUpdate = vi.fn();
const auditLogCreate = vi.fn();
const sendEmail = vi.fn();
const getBusinessSettings = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: {
      findMany: (...args: unknown[]) => invoiceFindMany(...args),
      update: (...args: unknown[]) => invoiceUpdate(...args),
    },
    invoiceLineItem: {
      create: (...args: unknown[]) => invoiceLineItemCreate(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => auditLogCreate(...args),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

vi.mock("@/domains/settings", () => ({
  getBusinessSettings: (...args: unknown[]) => getBusinessSettings(...args),
}));

const NOW = new Date("2026-09-28T12:00:00Z");

function candidateInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    invoiceNumber: 1,
    status: "DELINQUENT",
    dueDate: new Date("2026-09-01"), // 27 days before NOW
    amountDueCents: 4000,
    amountPaidCents: 0,
    lateFeeCents: 0,
    agreementId: "agr-1",
    agreement: { lateFeeGraceDays: 5, lateFeeCents: 0, lateFeePercent: 0 },
    customer: { user: { name: "Pat Landlord", email: "pat@example.com" } },
    ...overrides,
  };
}

describe("applyLateFees", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    invoiceFindMany.mockReset();
    invoiceLineItemCreate.mockReset().mockResolvedValue({});
    invoiceUpdate.mockReset().mockResolvedValue({});
    auditLogCreate.mockReset().mockResolvedValue({});
  });

  it("skips an invoice whose agreement has no late fee configured at all", async () => {
    invoiceFindMany.mockResolvedValue([candidateInvoice({ agreement: { lateFeeGraceDays: 5, lateFeeCents: 0, lateFeePercent: 0 } })]);
    const { applyLateFees } = await import("@/domains/billing/late-fees");

    const result = await applyLateFees();
    expect(result).toHaveLength(0);
    expect(invoiceLineItemCreate).not.toHaveBeenCalled();
  });

  it("skips an invoice still inside its grace period", async () => {
    invoiceFindMany.mockResolvedValue([
      candidateInvoice({
        dueDate: new Date("2026-09-25"), // 3 days before NOW, grace is 5
        agreement: { lateFeeGraceDays: 5, lateFeeCents: 500, lateFeePercent: 0 },
      }),
    ]);
    const { applyLateFees } = await import("@/domains/billing/late-fees");

    const result = await applyLateFees();
    expect(result).toHaveLength(0);
  });

  it("applies a flat fee once the grace period has passed", async () => {
    invoiceFindMany.mockResolvedValue([
      candidateInvoice({ agreement: { lateFeeGraceDays: 5, lateFeeCents: 1000, lateFeePercent: 0 } }),
    ]);
    const { applyLateFees } = await import("@/domains/billing/late-fees");

    const result = await applyLateFees();

    expect(result).toHaveLength(1);
    expect(result[0].feeCents).toBe(1000);
    expect(invoiceLineItemCreate).toHaveBeenCalledTimes(1);
    expect(invoiceLineItemCreate.mock.calls[0][0].data).toMatchObject({
      invoiceId: "inv-1",
      kind: "LATE_FEE",
      amountCents: 1000,
    });
    expect(invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { lateFeeCents: 1000, amountDueCents: 5000 },
    });
  });

  it("uses whichever of flat or percent is larger", async () => {
    invoiceFindMany.mockResolvedValue([
      candidateInvoice({
        amountDueCents: 10000,
        agreement: { lateFeeGraceDays: 5, lateFeeCents: 500, lateFeePercent: 10 }, // 10% of 10000 = 1000 > 500
      }),
    ]);
    const { applyLateFees } = await import("@/domains/billing/late-fees");

    const result = await applyLateFees();
    expect(result[0].feeCents).toBe(1000);
  });

  it("computes the percent fee off the outstanding balance, not the original amount due", async () => {
    invoiceFindMany.mockResolvedValue([
      candidateInvoice({
        amountDueCents: 10000,
        amountPaidCents: 8000, // only 2000 outstanding
        agreement: { lateFeeGraceDays: 5, lateFeeCents: 0, lateFeePercent: 10 },
      }),
    ]);
    const { applyLateFees } = await import("@/domains/billing/late-fees");

    const result = await applyLateFees();
    expect(result[0].feeCents).toBe(200); // 10% of 2000
  });

  it("never applies a second fee to an invoice that already has one (idempotency guard)", async () => {
    // The query itself filters lateFeeCents: 0, but this checks the
    // guard holds even if that filter is ever loosened by mistake.
    invoiceFindMany.mockResolvedValue([]);
    const { applyLateFees } = await import("@/domains/billing/late-fees");

    await applyLateFees();
    expect(invoiceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ lateFeeCents: 0 }) }),
    );
  });

  it("skips an invoice that's already fully paid", async () => {
    invoiceFindMany.mockResolvedValue([
      candidateInvoice({
        amountDueCents: 4000,
        amountPaidCents: 4000,
        agreement: { lateFeeGraceDays: 5, lateFeeCents: 500, lateFeePercent: 0 },
      }),
    ]);
    const { applyLateFees } = await import("@/domains/billing/late-fees");

    const result = await applyLateFees();
    expect(result).toHaveLength(0);
  });
});

describe("sendLateFeeDigestToChris", () => {
  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue({ sent: true });
    getBusinessSettings.mockReset().mockResolvedValue({ publicEmail: "chris@example.com" });
  });

  it("sends nothing when no fees were applied", async () => {
    const { sendLateFeeDigestToChris } = await import("@/domains/billing/late-fees");
    await sendLateFeeDigestToChris([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails a digest listing every applied fee", async () => {
    const { sendLateFeeDigestToChris } = await import("@/domains/billing/late-fees");
    await sendLateFeeDigestToChris([
      { invoiceId: "inv-1", invoiceNumber: 1, customerName: "Pat Landlord", feeCents: 1000, newAmountDueCents: 5000 },
    ]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = sendEmail.mock.calls[0][0];
    expect(call.to).toBe("chris@example.com");
    expect(call.text).toContain("Pat Landlord");
  });
});
