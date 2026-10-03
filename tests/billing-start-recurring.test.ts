import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
          findUniqueOrThrow: (...args: unknown[]) =>
            mocks.rentalAgreementFindUniqueOrThrow(...args),
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

describe("startRecurringBillingForAgreement", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.queryRaw.mockResolvedValue([
      { id: "agr-1", stripeSubscriptionId: null, billingStartedAt: null },
    ]);
    mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement());
    mocks.rentalAgreementUpdate.mockResolvedValue({});
    mocks.claimProviderOperation.mockResolvedValue({
      done: false,
      opId: "provider-op-1",
      idempotencyKey: "subscription-create-agr-1",
    });
    mocks.completeProviderOperation.mockResolvedValue(undefined);
    mocks.taxRatesList.mockResolvedValue({ data: [] });
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

  it("does nothing when the agreement already has a subscription id", async () => {
    mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
      baseAgreement({ stripeSubscriptionId: "sub_already" }),
    );
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    await startRecurringBillingForAgreement("agr-1");

    expect(mocks.claimProviderOperation).not.toHaveBeenCalled();
    expect(mocks.productsCreate).not.toHaveBeenCalled();
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
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

      await startRecurringBillingForAgreement("agr-1");

      expect(mocks.claimProviderOperation).not.toHaveBeenCalled();
      expect(mocks.productsCreate).not.toHaveBeenCalled();
      expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
    },
  );

  it("clears a stale recurring-billing blocker for a prepaid agreement", async () => {
    mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
      baseAgreement({ paidInFullInAdvance: true, billingBlockedReason: "Missing card" }),
    );
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    await startRecurringBillingForAgreement("agr-1");

    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { billingBlockedReason: null },
    });
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
  });

  it("records a blocker instead of throwing when no saved payment method exists", async () => {
    mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
      baseAgreement({
        customer: { stripeCustomerId: "cus_fake_1", stripeDefaultPaymentMethodId: null },
      }),
    );
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    await expect(startRecurringBillingForAgreement("agr-1")).resolves.not.toThrow();

    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { billingBlockedReason: expect.stringMatching(/hasn't completed checkout/i) },
    });
  });

  it("persists the Stripe subscription id after a successful provider write", async () => {
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    await startRecurringBillingForAgreement("agr-1");

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
        metadata: { agreementId: "agr-1" },
      }),
    );
    expect(params).not.toHaveProperty("cancel_at");
    expect(options).toEqual({ idempotencyKey: "subscription-create-agr-1" });

    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: {
        stripeSubscriptionId: "sub_fake_1",
        billingStartedAt: expect.any(Date),
        billingBlockedReason: null,
      },
    });
    expect(mocks.completeProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      "provider-op-1",
      { status: "SUCCEEDED", providerObjectId: "sub_fake_1" },
    );
  });

  it("heals the local subscription id from an already-succeeded provider operation", async () => {
    mocks.claimProviderOperation.mockResolvedValue({
      done: true,
      providerObjectId: "sub_recovered",
    });
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    await startRecurringBillingForAgreement("agr-1");

    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: {
        stripeSubscriptionId: "sub_recovered",
        billingStartedAt: expect.any(Date),
        billingBlockedReason: null,
      },
    });
  });

  it("sets cancel_at to the last second of the Colorado end date for a fixed term", async () => {
    mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
      baseAgreement({
        termMonths: 12,
        endDate: new Date("2026-11-01T12:00:00.000Z"),
      }),
    );
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    await startRecurringBillingForAgreement("agr-1");

    const [params] = mocks.subscriptionsCreate.mock.calls[0]!;
    expect(params.cancel_at).toBe(Math.floor(Date.parse("2026-11-02T06:59:59.000Z") / 1000));
  });

  describe("a fixed term starts at delivery (owner decision IN-20)", () => {
    const deliveredAt = new Date("2026-11-08T19:00:00.000Z");
    const expectedEnd = new Date("2027-11-08T06:59:59.000Z");

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(deliveredAt);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("saves the end date from the delivery date and sends it to Stripe as cancel_at", async () => {
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement({ termMonths: 12 }));
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
        where: { id: "agr-1" },
        data: { endDate: expectedEnd },
      });
      const [params] = mocks.subscriptionsCreate.mock.calls[0]!;
      expect(params.cancel_at).toBe(Math.floor(expectedEnd.getTime() / 1000));
    });

    it("counts a six-month term from delivery too", async () => {
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement({ termMonths: 6 }));
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
        where: { id: "agr-1" },
        data: { endDate: new Date("2027-05-08T05:59:59.000Z") },
      });
    });

    it("never overwrites an end date that is already saved (a retry keeps the same stop date)", async () => {
      const saved = new Date("2027-03-01T06:59:59.000Z");
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
        baseAgreement({ termMonths: 12, endDate: saved }),
      );
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      const writes = mocks.rentalAgreementUpdate.mock.calls.filter(
        ([arg]) => (arg as { data: Record<string, unknown> }).data.endDate !== undefined,
      );
      expect(writes).toHaveLength(0);
      const [params] = mocks.subscriptionsCreate.mock.calls[0]!;
      expect(params.cancel_at).toBe(Math.floor(saved.getTime() / 1000));
    });

    it("counts from the recorded billing start when billing had already begun", async () => {
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
        baseAgreement({ termMonths: 12, billingStartedAt: new Date("2026-10-01T18:00:00.000Z") }),
      );
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
        where: { id: "agr-1" },
        data: { endDate: new Date("2027-10-01T05:59:59.000Z") },
      });
    });

    it("gives a prepaid fixed term its end date at delivery as well, with no subscription", async () => {
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
        baseAgreement({ termMonths: 12, paidInFullInAdvance: true }),
      );
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
        where: { id: "agr-1" },
        data: { endDate: expectedEnd },
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

  it("marks an ambiguous Stripe result UNKNOWN and blocks automatic retry", async () => {
    const timeout = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    mocks.runProviderCall.mockResolvedValue({ ok: false, outcome: "UNKNOWN", error: timeout });
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    await expect(startRecurringBillingForAgreement("agr-1")).resolves.not.toThrow();

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

  it("never overwrites a different subscription id that appears during reconciliation", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([
        { id: "agr-1", stripeSubscriptionId: null, billingStartedAt: null },
      ])
      .mockResolvedValueOnce([
        { id: "agr-1", stripeSubscriptionId: "sub_other", billingStartedAt: null },
      ]);
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    await startRecurringBillingForAgreement("agr-1");

    expect(mocks.completeProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      "provider-op-1",
      expect.objectContaining({
        status: "DRIFT",
        providerObjectId: "sub_fake_1",
      }),
    );
    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { billingBlockedReason: expect.stringMatching(/reconcile stripe/i) },
    });
  });

  describe("exact tax rates sent to Stripe", () => {
    it("creates a 7.375% rate exactly when none exists", async () => {
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
        baseAgreement({ taxRateMilliPercent: 7375 }),
      );
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      expect(mocks.taxRatesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ percentage: 7.375, inclusive: false }),
      );
    });

    it("reuses a matching rate found on a later page instead of creating a duplicate", async () => {
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
        baseAgreement({ taxRateMilliPercent: 7375 }),
      );
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
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
        baseAgreement({ taxRateMilliPercent: 7375 }),
      );
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
