import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FIRST_DELIVERED = new Date("2026-10-01T06:00:00.000Z");
const RETRY_TIME = new Date("2026-11-15T18:00:00.000Z");

const mocks = vi.hoisted(() => {
  class RetryLater extends Error {
    constructor(message = "This provider operation is already in progress.") {
      super(message);
      this.name = "RetryLater";
    }
  }

  return {
    RetryLater,
    queryRaw: vi.fn(),
    rentalAgreementFindUniqueOrThrow: vi.fn(),
    rentalAgreementUpdate: vi.fn(),
    claimProviderOperation: vi.fn(),
    completeProviderOperation: vi.fn(),
    runProviderCall: vi.fn(),
    taxRatesList: vi.fn(),
    taxRatesCreate: vi.fn(),
    productsCreate: vi.fn(),
    subscriptionsCreate: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args),
        rentalAgreement: {
          findUniqueOrThrow: (...args: unknown[]) => mocks.rentalAgreementFindUniqueOrThrow(...args),
          update: (...args: unknown[]) => mocks.rentalAgreementUpdate(...args),
        },
      }),
    rentalAgreement: {
      update: (...args: unknown[]) => mocks.rentalAgreementUpdate(...args),
    },
  },
}));

vi.mock("@/domains/billing/provider-ops", () => ({
  RetryLater: mocks.RetryLater,
  claimProviderOperation: (...args: unknown[]) => mocks.claimProviderOperation(...args),
  completeProviderOperation: (...args: unknown[]) => mocks.completeProviderOperation(...args),
  runProviderCall: (...args: unknown[]) => mocks.runProviderCall(...args),
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    taxRates: {
      list: (...args: unknown[]) => mocks.taxRatesList(...args),
      create: (...args: unknown[]) => mocks.taxRatesCreate(...args),
    },
    products: { create: (...args: unknown[]) => mocks.productsCreate(...args) },
    subscriptions: { create: (...args: unknown[]) => mocks.subscriptionsCreate(...args) },
  }),
}));

function baseAgreement(overrides: Record<string, unknown> = {}) {
  return {
    id: "agr-1",
    customerId: "customer-1",
    stripeSubscriptionId: null,
    firstDeliveredOn: FIRST_DELIVERED,
    billingStartedAt: null,
    billingBlockedReason: null,
    termMonths: null,
    endDate: null,
    paidInFullInAdvance: false,
    taxRateMilliPercent: 0,
    depositCents: 0,
    damageWaiverCents: 0,
    customer: {
      stripeCustomerId: "cus_fake_1",
      stripeDefaultPaymentMethodId: "pm_fake_1",
    },
    lines: [{ id: "line-1", label: "Washer", monthlyPriceCents: 4000 }],
    ...overrides,
  };
}

function lockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "agr-1",
    stripeSubscriptionId: null,
    billingStartedAt: null,
    firstDeliveredOn: FIRST_DELIVERED,
    ...overrides,
  };
}

describe("startRecurringBillingForAgreement", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(RETRY_TIME);
    vi.clearAllMocks();

    mocks.queryRaw.mockResolvedValue([lockRow()]);
    mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement());
    mocks.rentalAgreementUpdate.mockResolvedValue({});
    mocks.claimProviderOperation.mockResolvedValue({
      done: false,
      opId: "provider-op-1",
      idempotencyKey: "subscription-create-agr-1",
    });
    mocks.completeProviderOperation.mockResolvedValue(undefined);
    mocks.taxRatesList.mockResolvedValue({ data: [], has_more: false });
    mocks.taxRatesCreate.mockResolvedValue({ id: "txr_fake_1" });
    mocks.productsCreate.mockImplementation(async ({ name }: { name: string }) => ({
      id: `prod_${name.replace(/\s+/g, "_")}`,
    }));
    mocks.subscriptionsCreate.mockResolvedValue({ id: "sub_fake_1" });
    mocks.runProviderCall.mockImplementation(async (call: () => Promise<unknown>) => {
      try {
        return { ok: true, value: await call() };
      } catch (error) {
        return { ok: false, outcome: "FAILED", error };
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks recurring billing when there is no durable first-delivery fact", async () => {
    mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
      baseAgreement({ firstDeliveredOn: null, billingStartedAt: null }),
    );
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    const outcome = await startRecurringBillingForAgreement("agr-1");

    expect(outcome).toMatchObject({ state: "BLOCKED" });
    expect(mocks.claimProviderOperation).not.toHaveBeenCalled();
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { billingBlockedReason: expect.stringMatching(/actually been delivered/i) },
    });
  });

  it("does no provider work when the agreement already has a subscription id", async () => {
    mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
      baseAgreement({ stripeSubscriptionId: "sub_already" }),
    );
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    const outcome = await startRecurringBillingForAgreement("agr-1");

    expect(outcome).toEqual({ state: "DONE" });
    expect(mocks.claimProviderOperation).not.toHaveBeenCalled();
    expect(mocks.productsCreate).not.toHaveBeenCalled();
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { billingStartedAt: FIRST_DELIVERED, billingBlockedReason: null },
    });
  });

  it.each([true, false])(
    "never starts recurring rent for a recorded full-term payment, free-month bonus %s",
    async (freeMonthGranted) => {
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
        baseAgreement({
          termMonths: 12,
          paidInFullInAdvance: true,
          freeMonthGranted,
          customer: { stripeCustomerId: null, stripeDefaultPaymentMethodId: null },
        }),
      );
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      const outcome = await startRecurringBillingForAgreement("agr-1");

      expect(outcome).toEqual({ state: "DONE" });
      expect(mocks.claimProviderOperation).not.toHaveBeenCalled();
      expect(mocks.productsCreate).not.toHaveBeenCalled();
      expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
      expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
        where: { id: "agr-1" },
        data: { billingBlockedReason: null, billingStartedAt: FIRST_DELIVERED },
      });
    },
  );

  it("records BLOCKED instead of pretending success when no saved payment method exists", async () => {
    mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
      baseAgreement({
        customer: { stripeCustomerId: "cus_fake_1", stripeDefaultPaymentMethodId: null },
      }),
    );
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    const outcome = await startRecurringBillingForAgreement("agr-1");

    expect(outcome).toMatchObject({ state: "BLOCKED" });
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { billingBlockedReason: expect.stringMatching(/hasn't completed checkout/i) },
    });
  });

  it("backdates the provider subscription to first delivery while keeping the next anniversary anchor", async () => {
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    const outcome = await startRecurringBillingForAgreement("agr-1");

    expect(outcome).toEqual({ state: "DONE" });
    expect(mocks.productsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Washer",
        metadata: expect.objectContaining({ agreementId: "agr-1", rentalLineId: "line-1" }),
      }),
      { idempotencyKey: "product-line-1" },
    );
    expect(mocks.subscriptionsCreate).toHaveBeenCalledTimes(1);
    const [params, options] = mocks.subscriptionsCreate.mock.calls[0]!;
    expect(params).toEqual(
      expect.objectContaining({
        customer: "cus_fake_1",
        default_payment_method: "pm_fake_1",
        metadata: {
          agreementId: "agr-1",
          firstDeliveredOn: FIRST_DELIVERED.toISOString(),
        },
        backdate_start_date: Math.floor(FIRST_DELIVERED.getTime() / 1000),
      }),
    );
    expect(params.billing_cycle_anchor).toBeGreaterThan(Math.floor(RETRY_TIME.getTime() / 1000));
    expect(params).not.toHaveProperty("cancel_at");
    expect(options).toEqual({ idempotencyKey: "subscription-create-agr-1" });

    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: {
        stripeSubscriptionId: "sub_fake_1",
        billingStartedAt: FIRST_DELIVERED,
        billingBlockedReason: null,
      },
    });
    expect(mocks.completeProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      "provider-op-1",
      { status: "SUCCEEDED", providerObjectId: "sub_fake_1" },
    );
  });

  it("heals the local subscription id from an already-succeeded provider operation using the delivery anchor", async () => {
    mocks.claimProviderOperation.mockResolvedValue({ done: true, providerObjectId: "sub_recovered" });
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    const outcome = await startRecurringBillingForAgreement("agr-1");

    expect(outcome).toEqual({ state: "DONE" });
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: {
        stripeSubscriptionId: "sub_recovered",
        billingStartedAt: FIRST_DELIVERED,
        billingBlockedReason: null,
      },
    });
  });

  it("sets cancel_at from a fixed term's already-saved Colorado end date", async () => {
    mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
      baseAgreement({ termMonths: 12, endDate: new Date("2026-11-01T12:00:00.000Z") }),
    );
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    await startRecurringBillingForAgreement("agr-1");

    const [params] = mocks.subscriptionsCreate.mock.calls[0]!;
    expect(params.cancel_at).toBe(Math.floor(Date.parse("2026-11-02T06:59:59.000Z") / 1000));
  });

  describe("fixed terms are anchored to first delivery, never provider retry time", () => {
    it("derives a 12-month end from first delivery even when Stripe is retried six weeks later", async () => {
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement({ termMonths: 12 }));
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      const expectedEnd = new Date("2027-10-01T05:59:59.999Z");
      expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
        where: { id: "agr-1" },
        data: { endDate: expectedEnd },
      });
      const [params] = mocks.subscriptionsCreate.mock.calls[0]!;
      expect(params.cancel_at).toBe(Math.floor(expectedEnd.getTime() / 1000));
    });

    it("derives a six-month end from the same delivery anchor", async () => {
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement({ termMonths: 6 }));
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
        where: { id: "agr-1" },
        data: { endDate: new Date("2027-04-01T05:59:59.999Z") },
      });
    });

    it("never overwrites an end date already saved by an earlier attempt", async () => {
      const saved = new Date("2027-03-01T06:59:59.000Z");
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement({ termMonths: 12, endDate: saved }));
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      const writes = mocks.rentalAgreementUpdate.mock.calls.filter(
        ([arg]) => (arg as { data: Record<string, unknown> }).data.endDate !== undefined,
      );
      expect(writes).toHaveLength(0);
      const [params] = mocks.subscriptionsCreate.mock.calls[0]!;
      expect(params.cancel_at).toBe(Math.floor(saved.getTime() / 1000));
    });

    it("uses billingStartedAt only as historical compatibility when firstDeliveredOn predates the new column", async () => {
      const historical = new Date("2026-09-12T06:00:00.000Z");
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
        baseAgreement({ firstDeliveredOn: null, billingStartedAt: historical, termMonths: 12 }),
      );
      mocks.queryRaw.mockResolvedValue([lockRow({ firstDeliveredOn: historical, billingStartedAt: historical })]);
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
        where: { id: "agr-1" },
        data: { endDate: new Date("2027-09-12T05:59:59.999Z") },
      });
    });

    it("gives a prepaid fixed term the delivery-based end date without creating a subscription", async () => {
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
        baseAgreement({ termMonths: 12, paidInFullInAdvance: true }),
      );
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      const outcome = await startRecurringBillingForAgreement("agr-1");

      expect(outcome).toEqual({ state: "DONE" });
      expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
        where: { id: "agr-1" },
        data: { endDate: new Date("2027-10-01T05:59:59.999Z") },
      });
      expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
    });

    it("leaves a month-to-month agreement without an end date and without cancel_at", async () => {
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      const writes = mocks.rentalAgreementUpdate.mock.calls.filter(
        ([arg]) => (arg as { data: Record<string, unknown> }).data.endDate !== undefined,
      );
      expect(writes).toHaveLength(0);
      const [params] = mocks.subscriptionsCreate.mock.calls[0]!;
      expect(params.cancel_at).toBeUndefined();
    });
  });

  it("returns UNKNOWN for an ambiguous Stripe result and leaves reconciliation visible", async () => {
    const timeout = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    mocks.runProviderCall.mockResolvedValue({ ok: false, outcome: "UNKNOWN", error: timeout });
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    const outcome = await startRecurringBillingForAgreement("agr-1");

    expect(outcome).toMatchObject({ state: "UNKNOWN" });
    expect(mocks.completeProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      "provider-op-1",
      { status: "UNKNOWN", error: timeout },
    );
    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { billingBlockedReason: expect.stringMatching(/reconcile stripe/i) },
    });
  });

  it("returns RETRY for a fresh competing provider claim rather than false success", async () => {
    mocks.claimProviderOperation.mockRejectedValue(new mocks.RetryLater());
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    const outcome = await startRecurringBillingForAgreement("agr-1");

    expect(outcome).toMatchObject({ state: "RETRY" });
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
  });

  it("never overwrites a different subscription id that appears during reconciliation", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([lockRow()])
      .mockResolvedValueOnce([lockRow({ stripeSubscriptionId: "sub_other" })]);
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    const outcome = await startRecurringBillingForAgreement("agr-1");

    expect(outcome).toMatchObject({ state: "UNKNOWN" });
    expect(mocks.completeProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      "provider-op-1",
      expect.objectContaining({ status: "DRIFT", providerObjectId: "sub_fake_1" }),
    );
    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { billingBlockedReason: expect.stringMatching(/reconcile stripe/i) },
    });
  });

  describe("exact tax rates sent to Stripe", () => {
    it("creates a 7.375% rate exactly when none exists", async () => {
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement({ taxRateMilliPercent: 7375 }));
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      expect(mocks.taxRatesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ percentage: 7.375, inclusive: false }),
      );
    });

    it("reuses a matching rate found on a later page instead of creating a duplicate", async () => {
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement({ taxRateMilliPercent: 7375 }));
      mocks.taxRatesList
        .mockResolvedValueOnce({
          data: [{ id: "txr_other", percentage: 7.3, inclusive: false }],
          has_more: true,
        })
        .mockResolvedValueOnce({
          data: [
            { id: "txr_inclusive", percentage: 7.375, inclusive: true },
            { id: "txr_match", percentage: 7.375, inclusive: false },
          ],
          has_more: false,
        });
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      expect(mocks.taxRatesCreate).not.toHaveBeenCalled();
      expect(mocks.taxRatesList).toHaveBeenLastCalledWith(
        expect.objectContaining({ starting_after: "txr_other" }),
      );
    });

    it("does not treat 7.3% as 7.375%", async () => {
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement({ taxRateMilliPercent: 7375 }));
      mocks.taxRatesList.mockResolvedValue({
        data: [{ id: "txr_73", percentage: 7.3, inclusive: false }],
        has_more: false,
      });
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      expect(mocks.taxRatesCreate).toHaveBeenCalledOnce();
    });
  });
});
