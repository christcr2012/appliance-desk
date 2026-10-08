import { beforeEach, describe, expect, it, vi } from "vitest";

const invoiceFindMany = vi.fn();
const invoiceFindUniqueOrThrow = vi.fn();
const invoiceLineItemCreate = vi.fn();
const invoiceUpdate = vi.fn();
const auditLogCreate = vi.fn();
const queryRaw = vi.fn();
const transaction = vi.fn();
const deliverMessage = vi.fn();
const getBusinessSettings = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

vi.mock("@/domains/messaging/deliver", () => ({
  deliverMessage: (...args: unknown[]) => deliverMessage(...args),
}));
vi.mock("@/domains/settings", () => ({
  getBusinessSettings: (...args: unknown[]) => getBusinessSettings(...args),
}));

const NOW = new Date("2026-09-28T18:00:00Z");

type Candidate = ReturnType<typeof candidateInvoice>;
let current: Candidate | null = null;
let lockedOverrides: Record<string, unknown> = {};

function candidateInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    invoiceNumber: 1,
    status: "DELINQUENT",
    dueDate: new Date("2026-09-01T18:00:00Z"),
    amountDueCents: 4_000,
    amountPaidCents: 0,
    lateFeeCents: 0,
    agreementId: "agr-1",
    agreement: {
      lateFeeGraceDays: 5,
      lateFeeCents: 0,
      lateFeePercent: 0,
    },
    customer: {
      user: { name: "Pat Landlord", email: "pat@example.com" },
    },
    ...overrides,
  };
}

function lockedRow() {
  if (!current) return [];
  return [
    {
      id: current.id,
      invoiceNumber: current.invoiceNumber,
      status: current.status,
      dueDate: current.dueDate,
      lateFeeCents: current.lateFeeCents,
      amountDueCents: current.amountDueCents,
      amountPaidCents: current.amountPaidCents,
      agreementId: current.agreementId,
      ...lockedOverrides,
    },
  ];
}

describe("applyLateFees", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    current = null;
    lockedOverrides = {};
    invoiceFindMany.mockReset().mockImplementation(async () =>
      current ? [{ id: current.id }] : [],
    );
    invoiceFindUniqueOrThrow.mockReset().mockImplementation(async () => current);
    invoiceLineItemCreate.mockReset().mockResolvedValue({});
    invoiceUpdate.mockReset().mockResolvedValue({});
    auditLogCreate.mockReset().mockResolvedValue({});
    transaction.mockReset().mockImplementation(
      async (callback: (client: unknown) => Promise<unknown>) =>
        callback({
          $queryRaw: (...args: unknown[]) => queryRaw(...args),
          invoice: {
            findMany: (...args: unknown[]) => invoiceFindMany(...args),
            findUniqueOrThrow: (...args: unknown[]) => invoiceFindUniqueOrThrow(...args),
            update: (...args: unknown[]) => invoiceUpdate(...args),
          },
          invoiceLineItem: {
            create: (...args: unknown[]) => invoiceLineItemCreate(...args),
          },
          auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
        }),
    );
    queryRaw.mockReset().mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("pg_advisory_xact_lock")) return [{ pg_advisory_xact_lock: "" }];
      if (sql.includes('FROM "Invoice"')) return lockedRow();
      throw new Error(`Unexpected query: ${sql}`);
    });
  });

  it("takes the billing advisory lock before reading candidates", async () => {
    const { applyLateFees } = await import("@/domains/billing/late-fees");
    await applyLateFees();

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(String(queryRaw.mock.calls[0]?.[0])).toContain("pg_advisory_xact_lock");
    expect(invoiceFindMany).toHaveBeenCalledTimes(1);
  });

  it("holds one transaction and one advisory lock across multiple 100-row pages", async () => {
    const ids = Array.from({ length: 100 }, (_, index) => ({ id: `inv-${index}` }));
    invoiceFindMany.mockReset().mockResolvedValueOnce(ids).mockResolvedValueOnce([]);
    queryRaw.mockReset().mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("pg_advisory_xact_lock")) return [{ pg_advisory_xact_lock: "" }];
      if (sql.includes('FROM "Invoice"')) {
        return [
          {
            id: String(values[0]),
            invoiceNumber: 1,
            status: "DELINQUENT",
            dueDate: new Date("2026-09-01T18:00:00Z"),
            lateFeeCents: 0,
            amountDueCents: 4_000,
            amountPaidCents: 0,
            agreementId: "agr-1",
          },
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    invoiceFindUniqueOrThrow.mockReset().mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        candidateInvoice({
          id: where.id,
          agreement: { lateFeeGraceDays: 5, lateFeeCents: 500, lateFeePercent: 0 },
        }),
    );

    const { applyLateFees } = await import("@/domains/billing/late-fees");
    const result = await applyLateFees();

    expect(result).toHaveLength(100);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(
      queryRaw.mock.calls.filter((call) => String(call[0]).includes("pg_advisory_xact_lock")),
    ).toHaveLength(1);
    expect(invoiceFindMany).toHaveBeenCalledTimes(2);
  });

  it("skips an invoice whose agreement has no late fee configured", async () => {
    current = candidateInvoice();
    const { applyLateFees } = await import("@/domains/billing/late-fees");

    await expect(applyLateFees()).resolves.toEqual([]);
    expect(invoiceLineItemCreate).not.toHaveBeenCalled();
  });

  it("skips an invoice still inside its Colorado calendar-day grace period", async () => {
    current = candidateInvoice({
      dueDate: new Date("2026-09-25T18:00:00Z"),
      agreement: { lateFeeGraceDays: 5, lateFeeCents: 500, lateFeePercent: 0 },
    });
    const { applyLateFees } = await import("@/domains/billing/late-fees");

    await expect(applyLateFees()).resolves.toEqual([]);
  });

  it("applies the larger disclosed flat fee after the grace period", async () => {
    current = candidateInvoice({
      agreement: { lateFeeGraceDays: 5, lateFeeCents: 1_000, lateFeePercent: 0 },
    });
    const { applyLateFees } = await import("@/domains/billing/late-fees");

    const result = await applyLateFees();

    expect(result).toHaveLength(1);
    expect(result[0]?.feeCents).toBe(1_000);
    expect(invoiceLineItemCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceId: "inv-1",
        kind: "LATE_FEE",
        amountCents: 1_000,
      }),
    });
    expect(invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { lateFeeCents: 1_000, amountDueCents: 5_000 },
    });
  });

  it("uses whichever of flat or percent is larger, based on outstanding balance", async () => {
    current = candidateInvoice({
      amountDueCents: 10_000,
      amountPaidCents: 8_000,
      agreement: { lateFeeGraceDays: 5, lateFeeCents: 100, lateFeePercent: 10 },
    });
    const { applyLateFees } = await import("@/domains/billing/late-fees");

    const result = await applyLateFees();
    expect(result[0]?.feeCents).toBe(200);
  });

  it("rechecks lateFeeCents under the row lock and skips a racing prior application", async () => {
    current = candidateInvoice({
      agreement: { lateFeeGraceDays: 5, lateFeeCents: 500, lateFeePercent: 0 },
    });
    lockedOverrides = { lateFeeCents: 500 };
    const { applyLateFees } = await import("@/domains/billing/late-fees");

    await expect(applyLateFees()).resolves.toEqual([]);
    expect(invoiceLineItemCreate).not.toHaveBeenCalled();
  });

  it("skips an invoice that became fully paid before its lock was acquired", async () => {
    current = candidateInvoice({
      agreement: { lateFeeGraceDays: 5, lateFeeCents: 500, lateFeePercent: 0 },
    });
    lockedOverrides = { amountPaidCents: 4_000 };
    const { applyLateFees } = await import("@/domains/billing/late-fees");

    await expect(applyLateFees()).resolves.toEqual([]);
  });

  it("keeps lateFeeCents = 0 in the candidate query", async () => {
    const { applyLateFees } = await import("@/domains/billing/late-fees");
    await applyLateFees();
    expect(invoiceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lateFeeCents: 0 }),
      }),
    );
  });
});

describe("sendLateFeeDigestToChris", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    deliverMessage.mockReset().mockResolvedValue({ state: "ACCEPTED", deliveryId: "late-fee-digest", providerMessageId: "msg-1" });
    getBusinessSettings.mockReset().mockResolvedValue({ publicEmail: "chris@example.com" });
  });

  it("sends nothing when no fees were applied", async () => {
    const { sendLateFeeDigestToChris } = await import("@/domains/billing/late-fees");
    await sendLateFeeDigestToChris([]);
    expect(deliverMessage).not.toHaveBeenCalled();
  });

  it("records one idempotent digest listing every applied fee", async () => {
    const { sendLateFeeDigestToChris } = await import("@/domains/billing/late-fees");
    await sendLateFeeDigestToChris([
      {
        invoiceId: "inv-1",
        invoiceNumber: 1,
        customerName: "Pat Landlord",
        feeCents: 1_000,
        newAmountDueCents: 5_000,
      },
    ]);
    expect(deliverMessage).toHaveBeenCalledTimes(1);
    const message = deliverMessage.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      idempotencyKey: expect.stringMatching(/^late-fee-digest-/),
      channel: "EMAIL",
      purpose: "TRANSACTIONAL",
      templateKey: "late-fee-digest",
      recipient: { type: "Staff", address: "chris@example.com" },
    });
    expect(message.render().text).toContain("Pat Landlord");
  });
});
