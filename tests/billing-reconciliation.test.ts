import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  providerFindMany: vi.fn(),
  rentalFindMany: vi.fn(),
  rentalFindUnique: vi.fn(),
  invoiceFindMany: vi.fn(),
  paymentFindMany: vi.fn(),
  paymentFindFirst: vi.fn(),
  customerFindMany: vi.fn(),
  customerFindUnique: vi.fn(),
  creditFindUnique: vi.fn(),
  depositFindUnique: vi.fn(),
  refundFindUnique: vi.fn(),
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
  refundCreate: vi.fn(),
  checkoutSessionsList: vi.fn(),
  paymentIntentRetrieve: vi.fn(),
}));

function makeTx() {
  return {
    $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args),
    providerOperation: { update: (...args: unknown[]) => mocks.providerUpdate(...args) },
    rentalAgreement: { update: (...args: unknown[]) => mocks.rentalUpdate(...args) },
    customer: { update: (...args: unknown[]) => mocks.customerUpdate(...args) },
    customerCredit: { update: (...args: unknown[]) => mocks.creditUpdate(...args) },
    deposit: { updateMany: (...args: unknown[]) => mocks.depositUpdateMany(...args) },
    refund: { updateMany: (...args: unknown[]) => mocks.refundUpdateMany(...args) },
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
    payment: {
      findMany: (...args: unknown[]) => mocks.paymentFindMany(...args),
      findFirst: (...args: unknown[]) => mocks.paymentFindFirst(...args),
    },
    customer: {
      findMany: (...args: unknown[]) => mocks.customerFindMany(...args),
      findUnique: (...args: unknown[]) => mocks.customerFindUnique(...args),
      update: (...args: unknown[]) => mocks.customerUpdate(...args),
    },
    customerCredit: {
      findUnique: (...args: unknown[]) => mocks.creditFindUnique(...args),
      update: (...args: unknown[]) => mocks.creditUpdate(...args),
    },
    deposit: {
      findUnique: (...args: unknown[]) => mocks.depositFindUnique(...args),
      updateMany: (...args: unknown[]) => mocks.depositUpdateMany(...args),
    },
    refund: {
      findUnique: (...args: unknown[]) => mocks.refundFindUnique(...args),
      updateMany: (...args: unknown[]) => mocks.refundUpdateMany(...args),
    },
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
    refunds: {
      list: (...args: unknown[]) => mocks.refundList(...args),
      create: (...args: unknown[]) => mocks.refundCreate(...args),
    },
    checkout: {
      sessions: { list: (...args: unknown[]) => mocks.checkoutSessionsList(...args) },
    },
    paymentIntents: {
      retrieve: (...args: unknown[]) => mocks.paymentIntentRetrieve(...args),
    },
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
    mocks.paymentFindFirst.mockResolvedValue(null);
    mocks.customerFindMany.mockResolvedValue([]);
    mocks.refundList.mockResolvedValue({ data: [], has_more: false });
    mocks.balanceList.mockResolvedValue({ data: [], has_more: false });
    mocks.checkoutSessionsList.mockResolvedValue({ data: [], has_more: false });
    mocks.subscriptionSearch.mockResolvedValue({ data: [] });
    mocks.customerSearch.mockResolvedValue({ data: [] });
    mocks.completeProviderOperation.mockResolvedValue(undefined);
    mocks.claimProviderOperation.mockResolvedValue({
      done: false,
      opId: "op-retry",
      idempotencyKey: "retry-key",
    });
    mocks.providerUpdate.mockResolvedValue({});
    mocks.queryRaw.mockResolvedValue([]);
    mocks.runProviderCall.mockImplementation(async (call: () => Promise<unknown>) => {
      try {
        return { ok: true, value: await call() };
      } catch (error) {
        return { ok: false, outcome: "UNKNOWN", error };
      }
    });
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
    expect(mocks.claimProviderOperation).not.toHaveBeenCalled();
    expect(mocks.subscriptionCancel).not.toHaveBeenCalled();
  });

  it("retries an UNKNOWN cancellation under the provider lease after Stripe proves it is still live", async () => {
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
    mocks.subscriptionCancel.mockResolvedValue({ id: "sub_123", status: "canceled" });

    await expect(finishPendingProviderOperations()).resolves.toEqual({
      completed: 1,
      stillUnknown: 0,
    });
    expect(mocks.claimProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      {
        kind: "SUBSCRIPTION_CANCEL",
        subjectType: "RentalAgreement",
        subjectId: "agr-1",
        idempotencyKey: "subscription-cancel-agr-1",
        reconcileUnknownAfterProviderEvidence: true,
      },
    );
    expect(mocks.subscriptionCancel).toHaveBeenCalledWith(
      "sub_123",
      undefined,
      { idempotencyKey: "retry-key" },
    );
    expect(mocks.completeProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      "op-retry",
      { status: "SUCCEEDED", providerObjectId: "sub_123" },
    );
  });

  it("keeps an ambiguous leased cancellation retry UNKNOWN when the provider outcome is lost again", async () => {
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
    const retryError = new Error("simulated connection loss");
    mocks.subscriptionCancel.mockRejectedValue(retryError);

    await expect(finishPendingProviderOperations()).resolves.toEqual({
      completed: 0,
      stillUnknown: 1,
    });
    expect(mocks.subscriptionCancel).toHaveBeenCalledWith(
      "sub_123",
      undefined,
      { idempotencyKey: "retry-key" },
    );
    expect(mocks.completeProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      "op-retry",
      { status: "UNKNOWN", error: retryError },
    );
    expect(mocks.providerUpdate).toHaveBeenCalledWith({
      where: { id: "op-1" },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it("finds an ambiguous balance-credit write on a later Stripe page", async () => {
    const requestedAt = new Date("2026-10-02T20:00:00Z");
    const providerCreated = Math.floor(requestedAt.getTime() / 1000) + 10;
    mocks.providerFindMany.mockResolvedValue([
      {
        id: "op-credit",
        kind: "BALANCE_CREDIT",
        subjectType: "CustomerCredit",
        subjectId: "credit-1",
        idempotencyKey: "referral-credit-ref-1-referrer",
        status: "UNKNOWN",
        requestedAt,
      },
    ]);
    mocks.creditFindUnique.mockResolvedValue({
      id: "credit-1",
      amountCents: 2_500,
      remainingCents: 2_500,
      appliedViaStripeAt: null,
      reason: "Referral reward",
      sourceId: "ref-1",
      customer: { stripeCustomerId: "cus_123" },
    });
    mocks.balanceList
      .mockResolvedValueOnce({
        data: [{ id: "cbtxn_newer", created: providerCreated, metadata: {} }],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "cbtxn_match",
            created: providerCreated,
            metadata: { creditId: "credit-1" },
          },
        ],
        has_more: false,
      });
    mocks.queryRaw.mockResolvedValue([{ appliedViaStripeAt: null }]);

    await expect(finishPendingProviderOperations()).resolves.toEqual({
      completed: 1,
      stillUnknown: 0,
    });
    expect(mocks.balanceList).toHaveBeenNthCalledWith(1, "cus_123", { limit: 100 });
    expect(mocks.balanceList).toHaveBeenNthCalledWith(2, "cus_123", {
      limit: 100,
      starting_after: "cbtxn_newer",
    });
    expect(mocks.creditUpdate).toHaveBeenCalledWith({
      where: { id: "credit-1" },
      data: { appliedViaStripeAt: expect.any(Date), remainingCents: 0 },
    });
    expect(mocks.completeProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      "op-credit",
      { status: "SUCCEEDED", providerObjectId: "cbtxn_match" },
    );
    expect(mocks.balanceCreate).not.toHaveBeenCalled();
  });

  it("retries a definite failed invoice refund with the same reserved charge and idempotency key", async () => {
    const idempotencyKey = "invoice-refund-refund-1-charge-ch_123";
    mocks.providerFindMany.mockResolvedValue([
      {
        id: "op-refund",
        kind: "REFUND_CREATE",
        subjectType: "Refund",
        subjectId: "refund-1",
        idempotencyKey,
        status: "FAILED",
        requestedAt: new Date("2026-10-02T20:00:00Z"),
      },
    ]);
    mocks.refundList.mockResolvedValue({ data: [], has_more: false });
    mocks.refundFindUnique.mockResolvedValue({
      amountCents: 3_000,
      invoiceId: "invoice-1",
    });
    mocks.claimProviderOperation.mockResolvedValue({
      done: false,
      opId: "op-refund",
      idempotencyKey,
    });
    mocks.refundCreate.mockResolvedValue({ id: "re_retry_123" });

    await expect(finishPendingProviderOperations()).resolves.toEqual({
      completed: 1,
      stillUnknown: 0,
    });
    expect(mocks.claimProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      {
        kind: "REFUND_CREATE",
        subjectType: "Refund",
        subjectId: "refund-1",
        idempotencyKey,
      },
    );
    expect(mocks.refundCreate).toHaveBeenCalledWith(
      {
        charge: "ch_123",
        amount: 3_000,
        metadata: { refundId: "refund-1", invoiceId: "invoice-1" },
      },
      { idempotencyKey },
    );
    expect(mocks.refundUpdateMany).toHaveBeenCalledWith({
      where: { id: "refund-1", stripeRefundId: null },
      data: { stripeRefundId: "re_retry_123" },
    });
    expect(mocks.completeProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      "op-refund",
      { status: "SUCCEEDED", providerObjectId: "re_retry_123" },
    );
  });

  it("rotates an unresolved UNKNOWN refund behind unattempted reconciliation work", async () => {
    const idempotencyKey = "invoice-refund-refund-1-charge-ch_123";
    mocks.providerFindMany.mockResolvedValue([
      {
        id: "op-refund",
        kind: "REFUND_CREATE",
        subjectType: "Refund",
        subjectId: "refund-1",
        idempotencyKey,
        status: "UNKNOWN",
        requestedAt: new Date("2026-10-02T20:00:00Z"),
      },
    ]);
    mocks.refundList.mockResolvedValue({ data: [], has_more: false });

    await expect(finishPendingProviderOperations()).resolves.toEqual({
      completed: 0,
      stillUnknown: 1,
    });
    expect(mocks.providerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { status: "PENDING", updatedAt: { lte: expect.any(Date) } },
            { status: "UNKNOWN" },
            { status: "FAILED" },
          ],
        },
        orderBy: [{ updatedAt: "asc" }, { requestedAt: "asc" }],
      }),
    );
    expect(mocks.providerUpdate).toHaveBeenCalledWith({
      where: { id: "op-refund" },
      data: { updatedAt: expect.any(Date) },
    });
    expect(mocks.claimProviderOperation).not.toHaveBeenCalled();
    expect(mocks.refundCreate).not.toHaveBeenCalled();
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

  it("treats Stripe deleted-customer objects as missing billing identities", async () => {
    mocks.customerRetrieve.mockResolvedValue({
      id: "cus_missing",
      object: "customer",
      deleted: true,
    });

    const rows = await detectDrift(20);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "STRIPE_CUSTOMER_MISSING",
          subjectType: "Customer",
          subjectId: "cust-missing",
          detail: expect.stringContaining("deleted Stripe customer cus_missing"),
        }),
      ]),
    );
  });
});
