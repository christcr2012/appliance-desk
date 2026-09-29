import { describe, it, expect, vi, beforeEach } from "vitest";

// Real gap fixed 2026-09-27 (found by a code review, see
// docs/DECISIONS.md): createCheckoutSessionForAgreement used to pass no
// idempotency key to Stripe, so a double-click or a retried request could
// create two separate Checkout Sessions for the same agreement. This
// proves the fix — same agreement, same key, every time — using mocked
// prisma/Stripe clients (no real database or network call needed; the
// actual Stripe request shape is exercised by tests/billing.test.ts and
// the real webhook flow by tests/billing-webhooks.test.ts).

const rentalAgreementFindUniqueOrThrow = vi.fn();
const customerFindUniqueOrThrow = vi.fn();
const taxRatesList = vi.fn();
const checkoutSessionsCreate = vi.fn();
const depositCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: {
      findUniqueOrThrow: (...args: unknown[]) => rentalAgreementFindUniqueOrThrow(...args),
    },
    customer: {
      findUniqueOrThrow: (...args: unknown[]) => customerFindUniqueOrThrow(...args),
      update: vi.fn(),
    },
    // Estimate-deposit feature (2026-09-29) — see the matching comment in
    // tests/billing-checkout-mode.test.ts.
    deposit: {
      count: (...args: unknown[]) => depositCount(...args),
    },
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    taxRates: { list: (...args: unknown[]) => taxRatesList(...args) },
    checkout: { sessions: { create: (...args: unknown[]) => checkoutSessionsCreate(...args) } },
  }),
}));

describe("createCheckoutSessionForAgreement — idempotency", () => {
  beforeEach(() => {
    rentalAgreementFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "agr-1",
      customerId: "cust-1",
      taxRatePermille: 0,
      depositCents: 0,
      damageWaiverCents: 0,
      customer: { stripeCustomerId: "cus_fake_1", user: { name: "Test", email: "t@example.test" } },
      lines: [{ id: "line-1", label: "Washer", monthlyPriceCents: 4000 }],
    });
    customerFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "cust-1",
      stripeCustomerId: "cus_fake_1",
      user: { name: "Test", email: "t@example.test" },
    });
    taxRatesList.mockReset().mockResolvedValue({ data: [] });
    checkoutSessionsCreate.mockReset().mockResolvedValue({ url: "https://checkout.stripe.test/fake" });
    depositCount.mockReset().mockResolvedValue(0);
  });

  it("passes a Stripe idempotency key scoped to this agreement", async () => {
    const { createCheckoutSessionForAgreement } = await import("@/domains/billing/checkout");

    await createCheckoutSessionForAgreement("agr-1");

    expect(checkoutSessionsCreate).toHaveBeenCalledTimes(1);
    const [, options] = checkoutSessionsCreate.mock.calls[0];
    expect(options).toEqual({ idempotencyKey: "checkout-agreement-agr-1" });
  });

  it("uses the exact same key on a second call for the same agreement (what makes Stripe treat a retry as the same operation)", async () => {
    const { createCheckoutSessionForAgreement } = await import("@/domains/billing/checkout");

    await createCheckoutSessionForAgreement("agr-1");
    await createCheckoutSessionForAgreement("agr-1");

    const [, firstOptions] = checkoutSessionsCreate.mock.calls[0];
    const [, secondOptions] = checkoutSessionsCreate.mock.calls[1];
    expect(firstOptions).toEqual(secondOptions);
  });

  it("uses a different key for a different agreement", async () => {
    const { createCheckoutSessionForAgreement } = await import("@/domains/billing/checkout");

    await createCheckoutSessionForAgreement("agr-1");

    rentalAgreementFindUniqueOrThrow.mockResolvedValue({
      id: "agr-2",
      customerId: "cust-2",
      taxRatePermille: 0,
      depositCents: 0,
      damageWaiverCents: 0,
      customer: { stripeCustomerId: "cus_fake_2", user: { name: "Test 2", email: "t2@example.test" } },
      lines: [{ id: "line-2", label: "Dryer", monthlyPriceCents: 3500 }],
    });
    await createCheckoutSessionForAgreement("agr-2");

    const [, firstOptions] = checkoutSessionsCreate.mock.calls[0];
    const [, secondOptions] = checkoutSessionsCreate.mock.calls[1];
    expect(firstOptions).not.toEqual(secondOptions);
  });
});
