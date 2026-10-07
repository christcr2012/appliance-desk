import { describe, it, expect, vi, beforeEach } from "vitest";

// Billing starts at delivery, not at signing (Chris's explicit decision,
// 2026-09-28 — see docs/BUSINESS-RULES.md's Billing rules). The signing
// Checkout Session no longer creates a Subscription: it charges only the
// one-time deposit/damage waiver (mode "payment"), or — if there's
// nothing to charge — just saves a payment method for later (mode
// "setup"). Either way it always saves a payment method
// (setup_future_usage / setup_intent) for startRecurringBillingForAgreement
// to use once a delivery job completes.

const rentalAgreementFindUniqueOrThrow = vi.fn();
const customerFindUniqueOrThrow = vi.fn();
const checkoutSessionsCreate = vi.fn();
const depositCount = vi.fn();
const taxMocks = vi.hoisted(() => ({
  rateVersionIds: vi.fn(),
  ensureStripeTaxRate: vi.fn(),
}));

async function runTransaction(callback: (tx: unknown) => Promise<unknown>) {
  const customer = await customerFindUniqueOrThrow();
  return callback({
    $queryRaw: vi.fn().mockResolvedValue([
      { id: customer.id, stripeCustomerId: customer.stripeCustomerId },
    ]),
    customer: {
      findUniqueOrThrow: (...args: unknown[]) => customerFindUniqueOrThrow(...args),
      update: vi.fn(),
    },
  });
}

vi.mock("@/domains/tax/locations", () => ({
  assertTaxReadyForAgreement: vi.fn(async () => undefined),
  taxRateVersionIdsForAgreement: (...args: unknown[]) => taxMocks.rateVersionIds(...args),
}));

vi.mock("@/domains/tax/stripe-rates", () => ({
  ensureStripeTaxRate: (...args: unknown[]) => taxMocks.ensureStripeTaxRate(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (callback: (tx: unknown) => Promise<unknown>) => runTransaction(callback),
    rentalAgreement: {
      findUniqueOrThrow: (...args: unknown[]) => rentalAgreementFindUniqueOrThrow(...args),
    },
    customer: {
      findUniqueOrThrow: (...args: unknown[]) => customerFindUniqueOrThrow(...args),
      update: vi.fn(),
    },
    // Estimate-deposit feature (2026-09-29): createCheckoutSessionForAgreement
    // checks whether a deposit already exists for this agreement (e.g. one
    // collected earlier at estimate approval) before charging it again at
    // signing. These tests are all about a fresh agreement with no prior
    // deposit, so this always resolves to "none yet" unless a test says
    // otherwise.
    deposit: {
      count: (...args: unknown[]) => depositCount(...args),
    },
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    checkout: { sessions: { create: (...args: unknown[]) => checkoutSessionsCreate(...args) } },
  }),
}));

function baseAgreement(overrides: Record<string, unknown> = {}) {
  return {
    id: "agr-1",
    customerId: "cust-1",
    taxRateMilliPercent: 0,
    depositCents: 0,
    damageWaiverCents: 0,
    customer: { stripeCustomerId: "cus_fake_1", user: { name: "Test", email: "t@example.test" } },
    lines: [{ id: "line-1", label: "Washer", monthlyPriceCents: 4000 }],
    ...overrides,
  };
}

describe("createCheckoutSessionForAgreement — mode selection", () => {
  beforeEach(() => {
    rentalAgreementFindUniqueOrThrow.mockReset();
    customerFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "cust-1",
      stripeCustomerId: "cus_fake_1",
      user: { name: "Test", email: "t@example.test" },
    });
    checkoutSessionsCreate.mockReset().mockResolvedValue({ url: "https://checkout.stripe.test/fake" });
    depositCount.mockReset().mockResolvedValue(0);
    taxMocks.rateVersionIds.mockReset().mockResolvedValue([]);
    taxMocks.ensureStripeTaxRate
      .mockReset()
      .mockImplementation(async (rateVersionId: string) => `txr_${rateVersionId}`);
  });

  it("uses 'setup' mode (no charge) when there's no deposit or damage waiver", async () => {
    rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement());
    const { createCheckoutSessionForAgreement } = await import("@/domains/billing/checkout");

    await createCheckoutSessionForAgreement("agr-1");

    const [params] = checkoutSessionsCreate.mock.calls[0];
    expect(params.mode).toBe("setup");
    expect(params.line_items).toBeUndefined();
    expect(params.setup_intent_data).toEqual({ metadata: { agreementId: "agr-1" } });
  });

  it("uses 'payment' mode (never 'subscription') when there's a deposit, and saves the payment method for later", async () => {
    rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement({ depositCents: 15000 }));
    const { createCheckoutSessionForAgreement } = await import("@/domains/billing/checkout");

    await createCheckoutSessionForAgreement("agr-1");

    const [params] = checkoutSessionsCreate.mock.calls[0];
    expect(params.mode).toBe("payment");
    expect(params.payment_intent_data).toEqual({ setup_future_usage: "off_session" });
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items[0].price_data.unit_amount).toBe(15000);
  });

  it("charges the deposit and damage waiver but never the recurring rental line at signing", async () => {
    taxMocks.rateVersionIds.mockResolvedValue(["rate-waiver"]);
    rentalAgreementFindUniqueOrThrow.mockResolvedValue(
      baseAgreement({ depositCents: 15000, damageWaiverCents: 5000 }),
    );
    const { createCheckoutSessionForAgreement } = await import("@/domains/billing/checkout");

    await createCheckoutSessionForAgreement("agr-1");

    const [params] = checkoutSessionsCreate.mock.calls[0];
    expect(params.mode).toBe("payment");
    const names = params.line_items.map((li: { price_data: { product_data: { name: string } } }) => li.price_data.product_data.name);
    expect(names).toEqual(["Security deposit", "Damage waiver"]);
    expect(names).not.toContain("Washer");
    expect(params.line_items[0].tax_rates).toBeUndefined();
    expect(params.line_items[1].tax_rates).toEqual(["txr_rate-waiver"]);
    expect(taxMocks.rateVersionIds).toHaveBeenCalledWith(
      expect.anything(),
      "agr-1",
      expect.any(Date),
      "DAMAGE_WAIVER",
    );
  });

  it("still refuses an agreement with nothing at all to charge (no rental lines)", async () => {
    rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement({ lines: [] }));
    const { createCheckoutSessionForAgreement } = await import("@/domains/billing/checkout");

    await expect(createCheckoutSessionForAgreement("agr-1")).rejects.toThrow(/nothing to charge/i);
    expect(checkoutSessionsCreate).not.toHaveBeenCalled();
  });
});
