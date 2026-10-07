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
    rentalAgreementUpdateMany: vi.fn(),
    claimProviderOperation: vi.fn(),
    completeProviderOperation: vi.fn(),
    runProviderCall: vi.fn(),
    taxRateVersionIdsForAgreement: vi.fn(),
    ensureStripeTaxRate: vi.fn(),
    taxRatesList: vi.fn(),
    taxRatesCreate: vi.fn(),
    productsCreate: vi.fn(),
    subscriptionsCreate: vi.fn(),
  };
});

// The billing-end answer is stored and applied by tests/subscription-end-integration.test.ts against a real
// database; this fake-database test only checks the surrounding order of events, so it stubs those calls out.
vi.mock("@/domains/billing/subscription-end", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domains/billing/subscription-end")>()),
  recomputeForAgreementInTx: vi.fn(async () => [] as string[]),
  recomputeSubscriptionEndInTx: vi.fn(async () => ({ version: 1, changed: false })),
  applySubscriptionEnds: vi.fn(async () => undefined),
}));

vi.mock("@/domains/tax/locations", () => ({
  assertTaxReadyForAgreement: vi.fn(async () => undefined),
  taxRateVersionIdsForAgreement: (...args: unknown[]) =>
    mocks.taxRateVersionIdsForAgreement(...args),
}));

vi.mock("@/domains/tax/stripe-rates", () => ({
  ensureStripeTaxRate: (...args: unknown[]) => mocks.ensureStripeTaxRate(...args),
}));

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
      updateMany: (...args: unknown[]) => mocks.rentalAgreementUpdateMany(...args),
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
    mocks.rentalAgreementUpdateMany.mockResolvedValue({ count: 1 });
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
    mocks.taxRateVersionIdsForAgreement.mockResolvedValue([]);
    mocks.ensureStripeTaxRate.mockImplementation(async (rateVersionId: string) => `txr_${rateVersionId}`);
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
    },
  );

  it("clears a stale blocker for prepaid rent without inventing recurring-billing history", async () => {
    mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
      baseAgreement({ paidInFullInAdvance: true, billingBlockedReason: "Missing card" }),
    );
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    const outcome = await startRecurringBillingForAgreement("agr-1");

    expect(outcome).toEqual({ state: "DONE" });
    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { billingBlockedReason: null },
    });
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
  });

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

  it("tells Stripe the same start on a same-day run and on a run six weeks later (a retry must not change the request)", async () => {
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");
    await startRecurringBillingForAgreement("agr-1");
    vi.setSystemTime(FIRST_DELIVERED);
    mocks.subscriptionsCreate.mockClear();
    await startRecurringBillingForAgreement("agr-1");
    const [early] = mocks.subscriptionsCreate.mock.calls[0]!;
    expect(early.backdate_start_date).toBe(1790834400);
    expect(early.billing_mode).toEqual({ type: "flexible" });
  });

  it("starts a winter delivery at the Colorado midnight of that day (07:00 UTC) and a late-evening delivery on its own day", async () => {
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");
    // 2026-12-01 00:00 in Denver is 07:00 UTC (standard time).
    mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
      baseAgreement({ firstDeliveredOn: new Date("2026-12-01T07:00:00.000Z") }),
    );
    await startRecurringBillingForAgreement("agr-1");
    expect(mocks.subscriptionsCreate.mock.calls[0]![0].backdate_start_date).toBe(
      Date.parse("2026-12-01T07:00:00.000Z") / 1000,
    );
    mocks.subscriptionsCreate.mockClear();
    // 2026-10-01 23:30 Denver (05:30 UTC on the 2nd) is still the 1st in Colorado.
    mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
      baseAgreement({ firstDeliveredOn: new Date("2026-10-02T05:30:00.000Z") }),
    );
    await startRecurringBillingForAgreement("agr-1");
    expect(mocks.subscriptionsCreate.mock.calls[0]![0].backdate_start_date).toBe(1790834400);
  });

  it("keeps delivery provenance in Stripe metadata and bills from the delivery day (IN-28)", async () => {
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
      }),
    );
    // IN-28: billing begins on the real delivery day (Colorado midnight, 2026-10-01 = 06:00 UTC).
    expect(params).toHaveProperty("backdate_start_date", 1790834400);
    expect(params).toHaveProperty("billing_mode", { type: "flexible" });
    expect(params).not.toHaveProperty("billing_cycle_anchor");
    expect(params).not.toHaveProperty("billing_cycle_anchor_config");
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

      const expectedEnd = new Date("2027-10-01T05:59:59.000Z");
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
        data: { endDate: new Date("2027-04-01T05:59:59.000Z") },
      });
    });

    it("never overwrites an end date already saved by an earlier attempt", async () => {
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

    it("uses billingStartedAt only as historical compatibility when firstDeliveredOn predates the new column", async () => {
      const historical = new Date("2026-09-12T06:00:00.000Z");
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
        baseAgreement({ firstDeliveredOn: null, billingStartedAt: historical, termMonths: 12 }),
      );
      mocks.queryRaw.mockResolvedValue([
        lockRow({ firstDeliveredOn: historical, billingStartedAt: historical }),
      ]);
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
        where: { id: "agr-1" },
        data: { endDate: new Date("2027-09-12T05:59:59.000Z") },
      });
    });

    it("gives a prepaid fixed term the delivery-based end date without creating a subscription or billing start", async () => {
      mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(
        baseAgreement({ termMonths: 12, paidInFullInAdvance: true }),
      );
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      const outcome = await startRecurringBillingForAgreement("agr-1");

      expect(outcome).toEqual({ state: "DONE" });
      expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
        where: { id: "agr-1" },
        data: { endDate: new Date("2027-10-01T05:59:59.000Z") },
      });
      expect(
        mocks.rentalAgreementUpdate.mock.calls.some(
          ([arg]) => (arg as { data: Record<string, unknown> }).data.billingStartedAt !== undefined,
        ),
      ).toBe(false);
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
    expect(mocks.rentalAgreementUpdateMany).toHaveBeenCalledWith({
      where: { id: "agr-1", stripeSubscriptionId: null },
      data: { billingBlockedReason: expect.stringMatching(/already being started/i) },
    });
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

  describe("jurisdiction tax rates sent to Stripe", () => {
    it("applies every resolved rental jurisdiction rate to each recurring item", async () => {
      mocks.taxRateVersionIdsForAgreement.mockResolvedValue(["rate-state", "rate-city"]);
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      expect(mocks.ensureStripeTaxRate).toHaveBeenCalledTimes(2);
      expect(mocks.ensureStripeTaxRate).toHaveBeenNthCalledWith(1, "rate-state");
      expect(mocks.ensureStripeTaxRate).toHaveBeenNthCalledWith(2, "rate-city");
      const [params] = mocks.subscriptionsCreate.mock.calls[0]!;
      expect(params.items[0].tax_rates).toEqual(["txr_rate-state", "txr_rate-city"]);
    });

    it("blocks automatic backdating when the rental tax rate changed after delivery", async () => {
      mocks.taxRateVersionIdsForAgreement
        .mockResolvedValueOnce(["rate-at-delivery"])
        .mockResolvedValueOnce(["rate-today"]);
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      const outcome = await startRecurringBillingForAgreement("agr-1");

      expect(outcome).toMatchObject({
        state: "RETRY",
        detail: expect.stringMatching(/sales-tax rate changed after delivery/i),
      });
      expect(mocks.claimProviderOperation).not.toHaveBeenCalled();
      expect(mocks.ensureStripeTaxRate).not.toHaveBeenCalled();
      expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
    });

    it("omits Stripe tax rates when the rental resolves exempt", async () => {
      mocks.taxRateVersionIdsForAgreement.mockResolvedValue([]);
      const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

      await startRecurringBillingForAgreement("agr-1");

      const [params] = mocks.subscriptionsCreate.mock.calls[0]!;
      expect(params.items[0].tax_rates).toBeUndefined();
      expect(mocks.ensureStripeTaxRate).not.toHaveBeenCalled();
    });
  });
});
