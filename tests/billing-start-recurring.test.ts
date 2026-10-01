import { describe, it, expect, vi, beforeEach } from "vitest";

// Billing starts at delivery (2026-09-28): startRecurringBillingForAgreement
// is called once a delivery/installation job for an agreement is marked
// COMPLETED (src/domains/jobs/index.ts). It uses the payment method saved
// at signing to create the real Stripe Subscription — or, if there isn't
// one yet, records why on the agreement instead of throwing.

const rentalAgreementFindUniqueOrThrow = vi.fn();
const rentalAgreementUpdate = vi.fn();
const taxRatesList = vi.fn();
const productsCreate = vi.fn();
const subscriptionsCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: {
      findUniqueOrThrow: (...args: unknown[]) => rentalAgreementFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => rentalAgreementUpdate(...args),
    },
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    taxRates: { list: (...args: unknown[]) => taxRatesList(...args) },
    products: { create: (...args: unknown[]) => productsCreate(...args) },
    subscriptions: { create: (...args: unknown[]) => subscriptionsCreate(...args) },
  }),
}));

function baseAgreement(overrides: Record<string, unknown> = {}) {
  return {
    id: "agr-1",
    stripeSubscriptionId: null,
    taxRatePermille: 0,
    depositCents: 0,
    damageWaiverCents: 0,
    customer: { stripeCustomerId: "cus_fake_1", stripeDefaultPaymentMethodId: "pm_fake_1" },
    lines: [{ id: "line-1", label: "Washer", monthlyPriceCents: 4000 }],
    ...overrides,
  };
}

describe("startRecurringBillingForAgreement", () => {
  beforeEach(() => {
    rentalAgreementFindUniqueOrThrow.mockReset();
    rentalAgreementUpdate.mockReset().mockResolvedValue({});
    taxRatesList.mockReset().mockResolvedValue({ data: [] });
    productsCreate.mockReset().mockImplementation(async ({ name }: { name: string }) => ({
      id: `prod_${name.replace(/\s+/g, "_")}`,
    }));
    subscriptionsCreate.mockReset().mockResolvedValue({ id: "sub_fake_1" });
  });

  it("does nothing when the agreement is already billing (idempotent)", async () => {
    rentalAgreementFindUniqueOrThrow.mockResolvedValue(
      baseAgreement({ stripeSubscriptionId: "sub_already" }),
    );
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    await startRecurringBillingForAgreement("agr-1");

    expect(subscriptionsCreate).not.toHaveBeenCalled();
  });

  it.each([true, false])("never starts monthly rent for a recorded full-term payment, free-month bonus %s", async freeMonthGranted => {
    rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement({
      termMonths: 12, paidInFullInAdvance: true, freeMonthGranted,
      customer: { stripeCustomerId: null, stripeDefaultPaymentMethodId: null },
      billingBlockedReason: null,
    }));
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");
    await startRecurringBillingForAgreement("agr-1");
    await startRecurringBillingForAgreement("agr-1");
    expect(productsCreate).not.toHaveBeenCalled();
    expect(subscriptionsCreate).not.toHaveBeenCalled();
    expect(taxRatesList).not.toHaveBeenCalled();
    expect(rentalAgreementUpdate).not.toHaveBeenCalled();
  });

  it("clears a stale recurring-billing error for a prepaid agreement without recording a new collection", async () => {
    rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement({ paidInFullInAdvance: true, billingBlockedReason: "Missing card" }));
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");
    await startRecurringBillingForAgreement("agr-1");
    expect(rentalAgreementUpdate).toHaveBeenCalledWith({ where: { id: "agr-1" }, data: { billingBlockedReason: null } });
    expect(subscriptionsCreate).not.toHaveBeenCalled();
  });

  it("records billingBlockedReason instead of throwing when there's no saved payment method", async () => {
    rentalAgreementFindUniqueOrThrow.mockResolvedValue(
      baseAgreement({ customer: { stripeCustomerId: "cus_fake_1", stripeDefaultPaymentMethodId: null } }),
    );
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    await startRecurringBillingForAgreement("agr-1");

    expect(subscriptionsCreate).not.toHaveBeenCalled();
    expect(rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { billingBlockedReason: expect.stringMatching(/hasn't completed checkout/i) },
    });
  });

  it("creates a real Subscription using the saved payment method, with a Product per rental line", async () => {
    rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement());
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    await startRecurringBillingForAgreement("agr-1");

    expect(productsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Washer" }),
    );
    expect(subscriptionsCreate).toHaveBeenCalledTimes(1);
    const [params, options] = subscriptionsCreate.mock.calls[0];
    expect(params.customer).toBe("cus_fake_1");
    expect(params.default_payment_method).toBe("pm_fake_1");
    expect(params.items).toHaveLength(1);
    expect(params.items[0].price_data.unit_amount).toBe(4000);
    expect(params.items[0].price_data.recurring).toEqual({ interval: "month" });
    expect(options).toEqual({ idempotencyKey: "subscription-agreement-agr-1" });

    // Clears any previous blocked reason and stamps when billing actually
    // started (used by the MRR/ARR revenue trend — src/domains/billing/revenue.ts).
    expect(rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { billingBlockedReason: null, billingStartedAt: expect.any(Date) },
    });
  });

  it("records billingBlockedReason (never throws) when Stripe itself refuses the charge", async () => {
    rentalAgreementFindUniqueOrThrow.mockResolvedValue(baseAgreement());
    subscriptionsCreate.mockRejectedValue(new Error("Your card was declined."));
    const { startRecurringBillingForAgreement } = await import("@/domains/billing/checkout");

    await expect(startRecurringBillingForAgreement("agr-1")).resolves.not.toThrow();

    expect(rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { billingBlockedReason: expect.stringContaining("Your card was declined.") },
    });
  });
});
