import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  providerFindMany: vi.fn(),
  rentalFindMany: vi.fn(),
  rentalFindUnique: vi.fn(),
  invoiceFindMany: vi.fn(),
  paymentFindMany: vi.fn(),
  customerFindMany: vi.fn(),
  customerFindUnique: vi.fn(),
  creditFindUnique: vi.fn(),
  transaction: vi.fn(),
  providerUpdate: vi.fn(),
  rentalUpdate: vi.fn(),
  customerUpdate: vi.fn(),
  creditUpdate: vi.fn(),
  depositUpdateMany: vi.fn(),
  refundUpdateMany: vi.fn(),
  queryRaw: vi.fn(),
  completeProviderOperation: vi.fn(),
  claimProviderOperation: vi.fn(),
  runProviderCall: vi.fn(),
  subscriptionRetrieve: vi.fn(),
  subscriptionSearch: vi.fn(),
  subscriptionCancel: vi.fn(),
  customerSearch: vi.fn(),
  customerRetrieve: vi.fn(),
  balanceList: vi.fn(),
  balanceCreate: vi.fn(),
  refundList: vi.fn(),
}));

function makeTx() {
  return {
    $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args),
    providerOperation: { update: mocks.providerUpdate },
    rentalAgreement: { update: mocks.rentalUpdate },
    customer: { update: mocks.customerUpdate },
    customerCredit: { update: mocks.creditUpdate },
    deposit: { updateMany: mocks.depositUpdateMany },
    refund: { updateMany: mocks.refundUpdateMany },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    providerOperation: {
      findMany: (...args: unknown[]) => mocks.providerFindMany(...args),
      update: (...args: unknown[]) => mocks.providerUpdate(...args),
    },
    rentalAgreement: {
      findMany: (...args: unknown[]) => mocks.rentalFindMany(...args),
      findUnique: (...args: unknown[]) => mocks.rentalFindUnique(...args),
      update: (...args: unknown[]) => mocks.rentalUpdate(...args),
    },
    invoice: { findMany: (...args: unknown[]) => mocks.invoiceFindMany(...args) },
    payment: { findMany: (...args: unknown[]) => mocks.paymentFindMany(...args) },
    customer: {
      findMany: (...args: unknown[]) => mocks.customerFindMany(...args),
      findUnique: (...args: unknown[]) => mocks.customerFindUnique(...args),
      update: (...args: unknown[]) => mocks.customerUpdate(...args),
    },
    customerCredit: {
      findUnique: (...args: unknown[]) => mocks.creditFindUnique(...args),
      update: (...args: unknown[]) => mocks.creditUpdate(...args),
    },
    deposit: { updateMany: (...args: unknown[]) => mocks.depositUpdateMany(...args) },
    refund: { updateMany: (...args: unknown[]) => mocks.refundUpdateMany(...args) },
    $transaction: async (fn: (tx: ReturnType<typeof makeTx>) => unknown) => {
      mocks.transaction();
      return fn(makeTx());
    },
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    subscriptions: {
      retrieve: (...args: unknown[]) => mocks.subscriptionRetrieve(...args),
      search: (...args: unknown[]) => mocks.subscriptionSearch(...args),
      cancel: (...args: unknown[]) => mocks.subscriptionCancel(...args),
    },
    customers: {
      search: (...args: unknown[]) => mocks.customerSearch(...args),
      retrieve: (...args: unknown[]) => mocks.customerRetrieve(...args),
      listBalanceTransactions: (...args: unknown[]) => mocks.balanceList(...args),
      createBalanceTransaction: (...args: unknown[]) => mocks.balanceCreate(...args),
    },
    refunds: { list: (...args: unknown[]) => mocks.refundList(...args) },
  }),
}));

vi.mock("@/domains/billing/provider-ops", () => ({
  RetryLater: class RetryLater extends Error {},
  completeProviderOperation: (...args: unknown[]) =>
    mocks.completeProviderOperation(...args),
  claimProviderOperation: (...args: unknown[]) =>
    mocks.claimProviderOperation(...args),
  runProviderCall: (...args: unknown[]) => mocks.runProviderCall(...args),
}));

import {
  detectDrift,
  finishPendingProviderOperations,
} from "@/domains/billing/reconciliation";

describe("billing provider reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.providerFindMany.mockResolvedValue([]);
    mocks.rentalFindMany.mockResolvedValue([]);
    mocks.invoiceFindMany.mockResolvedValue([]);
    mocks.paymentFindMany.mockResolvedValue([]);
    mocks.customerFindMany.mockResolvedValue([]);
    mocks.refundList.mockResolvedValue({ data: [] });
    mocks.balanceList.mockResolvedValue({ data: [] });
    mocks.subscriptionSearch.mockResolvedValue({ data: [] });
    mocks.customerSearch.mockResolvedValue({ data: [] });
    mocks.completeProviderOperation.mockResolvedValue(undefined);
  });

  it("marks an UNKNOWN subscription cancellation SUCCEEDED when Stripe reports it canceled", async () => {
    mocks.providerFindMany.mockResolvedValue([
      {
        id: "op-1",
        kind: "SUBSCRIPTION_CANCEL",
        subjectType: "RentalAgreement",
        subjectId: "agr-1",
        idempotencyKey: "subscription-cancel-agr-1",
        status: "UNKNOWN",
        requestedAt: new Date("2026-10-02T00:00:00Z"),
      },
    ]);
    mocks.rentalFindUnique.mockResolvedValue({ stripeSubscriptionId: "sub_123" });
    mocks.subscriptionRetrieve.mockResolvedValue({ id: "sub_123", status: "canceled" });

    await expect(finishPendingProviderOperations()).resolves.toEqual({
      completed: 1,
      stillUnknown: 0,
    });
    expect(mocks.completeProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      "op-1",
      { status: "SUCCEEDED", providerObjectId: "sub_123" },
    );
    expect(mocks.subscriptionCancel).not.toHaveBeenCalled();
  });

  it("leaves an UNKNOWN cancellation unresolved when Stripe still reports it live", async () => {
    mocks.providerFindMany.mockResolvedValue([
      {
        id: "op-1",
        kind: "SUBSCRIPTION_CANCEL",
        subjectType: "RentalAgreement",
        subjectId: "agr-1",
        idempotencyKey: "subscription-cancel-agr-1",
        status: "UNKNOWN",
        requestedAt: new Date("2026-10-02T00:00:00Z"),
      },
    ]);
    mocks.rentalFindUnique.mockResolvedValue({ stripeSubscriptionId: "sub_123" });
    mocks.subscriptionRetrieve.mockResolvedValue({ id: "sub_123", status: "active" });

    await expect(finishPendingProviderOperations()).resolves.toEqual({
      completed: 0,
      stillUnknown: 1,
    });
    expect(mocks.subscriptionCancel).not.toHaveBeenCalled();
    expect(mocks.completeProviderOperation).not.toHaveBeenCalled();
  });
});

describe("detectDrift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.providerFindMany.mockResolvedValue([
      {
        id: "op-failed",
        kind: "BALANCE_CREDIT",
        subjectType: "CustomerCredit",
        subjectId: "credit-1",
        status: "FAILED",
        attempts: 2,
        requestedAt: new Date("2026-10-01T00:00:00Z"),
      },
    ]);
    mocks.rentalFindMany
      .mockResolvedValueOnce([
        { id: "agr-active", updatedAt: new Date("2026-10-01T01:00:00Z") },
      ])
      .mockResolvedValueOnce([
        {
          id: "agr-closed",
          stripeSubscriptionId: "sub_live",
          updatedAt: new Date("2026-10-01T02:00:00Z"),
        },
      ]);
    mocks.invoiceFindMany.mockResolvedValue([
      {
        id: "inv-mismatch",
        status: "PAID",
        amountDueCents: 10_000,
        amountPaidCents: 9_000,
        updatedAt: new Date("2026-10-01T03:00:00Z"),
      },
    ]);
    mocks.paymentFindMany.mockResolvedValue([
      {
        id: "pay-orphan",
        invoiceId: "inv-2",
        createdAt: new Date("2026-10-01T04:00:00Z"),
      },
    ]);
    mocks.customerFindMany.mockResolvedValue([
      {
        id: "cust-missing",
        stripeCustomerId: "cus_missing",
        updatedAt: new Date("2026-10-01T05:00:00Z"),
      },
    ]);
    mocks.subscriptionRetrieve.mockResolvedValue({ id: "sub_live", status: "active" });
    mocks.customerRetrieve.mockRejectedValue({
      type: "StripeInvalidRequestError",
      code: "resource_missing",
    });
  });

  it("returns bounded mismatch kinds without performing any local write", async () => {
    const rows = await detectDrift(20);
    expect(new Set(rows.map((row) => row.kind))).toEqual(
      new Set([
        "FAILED_OP",
        "LOCAL_ACTIVE_NO_SUB",
        "INVOICE_STATUS_MISMATCH",
        "PAYMENT_WITHOUT_RECEIPT",
        "SUB_LIVE_BUT_LOCAL_CLOSED",
        "STRIPE_CUSTOMER_MISSING",
      ]),
    );

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.providerUpdate).not.toHaveBeenCalled();
    expect(mocks.rentalUpdate).not.toHaveBeenCalled();
    expect(mocks.customerUpdate).not.toHaveBeenCalled();
    expect(mocks.creditUpdate).not.toHaveBeenCalled();
    expect(mocks.depositUpdateMany).not.toHaveBeenCalled();
    expect(mocks.refundUpdateMany).not.toHaveBeenCalled();
  });
});
