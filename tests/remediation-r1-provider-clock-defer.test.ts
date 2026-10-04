import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class RetryLater extends Error {}
  return {
    RetryLater,
    queryRaw: vi.fn(),
    rentalAgreementFindUniqueOrThrow: vi.fn(),
    rentalAgreementUpdate: vi.fn(),
    claimProviderOperation: vi.fn(),
    completeProviderOperation: vi.fn(),
    runProviderCall: vi.fn(),
    productsCreate: vi.fn(),
    subscriptionsCreate: vi.fn(),
    taxRatesList: vi.fn(),
    taxRatesCreate: vi.fn(),
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
    rentalAgreement: { update: (...args: unknown[]) => mocks.rentalAgreementUpdate(...args) },
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

const DELIVERED = new Date("2026-07-01T06:00:00.000Z"); // Colorado midnight during MDT.

function agreement() {
  return {
    id: "agr-provider-clock",
    customerId: "customer-provider-clock",
    stripeSubscriptionId: null,
    firstDeliveredOn: DELIVERED,
    billingStartedAt: null,
    billingBlockedReason: null,
    termMonths: null,
    endDate: null,
    paidInFullInAdvance: false,
    taxRateMilliPercent: 0,
    depositCents: 0,
    damageWaiverCents: 0,
    customer: {
      stripeCustomerId: "cus_provider_clock",
      stripeDefaultPaymentMethodId: "pm_provider_clock",
    },
    lines: [{ id: "line-provider-clock", label: "Washer", monthlyPriceCents: 4000 }],
  };
}

function lockRow() {
  return {
    id: "agr-provider-clock",
    stripeSubscriptionId: null,
    billingStartedAt: null,
    firstDeliveredOn: DELIVERED,
  };
}

describe("R1 Stripe provider-clock defer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([lockRow()]);
    mocks.rentalAgreementFindUniqueOrThrow.mockResolvedValue(agreement());
    mocks.rentalAgreementUpdate.mockResolvedValue({});
    mocks.claimProviderOperation.mockResolvedValue({
      done: false,
      opId: "op-provider-clock",
      idempotencyKey: "subscription-create-agr-provider-clock",
    });
    mocks.completeProviderOperation.mockResolvedValue(undefined);
    mocks.taxRatesList.mockResolvedValue({ data: [], has_more: false });
    mocks.taxRatesCreate.mockResolvedValue({ id: "txr-provider-clock" });
    mocks.productsCreate.mockResolvedValue({ id: "prod-provider-clock" });
    mocks.subscriptionsCreate.mockResolvedValue({ id: "sub-provider-clock" });
    mocks.runProviderCall.mockImplementation(async (call: () => Promise<unknown>) => ({ ok: true, value: await call() }));
  });

  afterEach(() => vi.useRealTimers());

  it("does not claim provider work before the same-date 07:00 UTC boundary, then starts from the original delivery date", async () => {
    vi.setSystemTime(new Date("2026-07-01T06:30:00.000Z"));
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    const deferred = await startRecurringBillingForAgreement("agr-provider-clock");
    expect(deferred).toMatchObject({ state: "BLOCKED", detail: expect.stringMatching(/safe billing boundary/i) });
    expect(mocks.claimProviderOperation).not.toHaveBeenCalled();
    expect(mocks.productsCreate).not.toHaveBeenCalled();
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
    expect(
      mocks.rentalAgreementUpdate.mock.calls.some(
        ([arg]) => (arg as { data?: { billingBlockedReason?: unknown } }).data?.billingBlockedReason !== undefined,
      ),
    ).toBe(false);

    vi.setSystemTime(new Date("2026-07-01T07:00:01.000Z"));
    const started = await startRecurringBillingForAgreement("agr-provider-clock");
    expect(started).toEqual({ state: "DONE" });
    expect(mocks.claimProviderOperation).toHaveBeenCalledTimes(1);
    expect(mocks.subscriptionsCreate).toHaveBeenCalledTimes(1);
    const [params] = mocks.subscriptionsCreate.mock.calls[0]!;
    expect(params).toEqual(
      expect.objectContaining({
        billing_mode: { type: "flexible" },
        backdate_start_date: Math.floor(Date.parse("2026-07-01T07:00:00.000Z") / 1000),
        billing_cycle_anchor_config: { day_of_month: 1, hour: 7, minute: 0, second: 0 },
      }),
    );
    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-provider-clock" },
      data: {
        stripeSubscriptionId: "sub-provider-clock",
        billingStartedAt: DELIVERED,
        billingBlockedReason: null,
      },
    });
  });
});
