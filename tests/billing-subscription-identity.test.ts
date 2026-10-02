import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  findBySubscription: vi.fn(),
  queryRaw: vi.fn(),
  txFindBySubscription: vi.fn(),
  updateAgreement: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  retrieveSubscription: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: {
      findUnique: (...args: unknown[]) => mocks.findBySubscription(...args),
    },
    $transaction: (...args: unknown[]) => mocks.transaction(...args),
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    subscriptions: {
      retrieve: (...args: unknown[]) => mocks.retrieveSubscription(...args),
    },
  }),
}));

function event(type: string, object: unknown): Stripe.Event {
  return { id: `evt-${type}`, type, data: { object } } as unknown as Stripe.Event;
}

function invoiceEvent(type: "invoice.paid" | "invoice.payment_failed", subscriptionId: string) {
  return event(type, {
    id: `in-${type}`,
    parent: { subscription_details: { subscription: subscriptionId } },
  });
}

function deletedEvent(subscriptionId: string, agreementId?: string) {
  return event("customer.subscription.deleted", {
    id: subscriptionId,
    metadata: agreementId ? { agreementId } : {},
  });
}

describe("Stripe subscription identity recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findBySubscription.mockResolvedValue(null);
    mocks.queryRaw.mockResolvedValue([{ id: "agr-1", stripeSubscriptionId: null }]);
    mocks.txFindBySubscription.mockResolvedValue(null);
    mocks.updateAgreement.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
    mocks.retrieveSubscription.mockResolvedValue({
      id: "sub-1",
      metadata: { agreementId: "agr-1" },
    });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args),
        rentalAgreement: {
          findUnique: (...args: unknown[]) => mocks.txFindBySubscription(...args),
          update: (...args: unknown[]) => mocks.updateAgreement(...args),
        },
        auditLog: {
          create: (...args: unknown[]) => mocks.auditCreate(...args),
        },
      }),
    );
  });

  it("skips provider lookup when the subscription is already linked locally", async () => {
    mocks.findBySubscription.mockResolvedValue({ id: "agr-1" });
    const { ensureSubscriptionIdentityForWebhook } = await import(
      "@/domains/billing/subscription-identity"
    );

    await ensureSubscriptionIdentityForWebhook(invoiceEvent("invoice.paid", "sub-1"));

    expect(mocks.retrieveSubscription).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("heals a missing subscription id from invoice subscription metadata", async () => {
    const { ensureSubscriptionIdentityForWebhook } = await import(
      "@/domains/billing/subscription-identity"
    );

    await ensureSubscriptionIdentityForWebhook(invoiceEvent("invoice.paid", "sub-1"));

    expect(mocks.retrieveSubscription).toHaveBeenCalledWith("sub-1");
    expect(mocks.updateAgreement).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { stripeSubscriptionId: "sub-1" },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "billing.subscription_id_healed",
        entityType: "RentalAgreement",
        entityId: "agr-1",
      }),
    });
  });

  it("uses metadata already present on subscription.deleted without another Stripe read", async () => {
    const { ensureSubscriptionIdentityForWebhook } = await import(
      "@/domains/billing/subscription-identity"
    );

    await ensureSubscriptionIdentityForWebhook(deletedEvent("sub-1", "agr-1"));

    expect(mocks.retrieveSubscription).not.toHaveBeenCalled();
    expect(mocks.updateAgreement).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { stripeSubscriptionId: "sub-1" },
    });
  });

  it("never overwrites a different subscription already linked to the metadata agreement", async () => {
    mocks.queryRaw.mockResolvedValue([{ id: "agr-1", stripeSubscriptionId: "sub-other" }]);
    const { ensureSubscriptionIdentityForWebhook } = await import(
      "@/domains/billing/subscription-identity"
    );

    await expect(
      ensureSubscriptionIdentityForWebhook(invoiceEvent("invoice.payment_failed", "sub-1")),
    ).rejects.toThrow(/identity conflict/i);

    expect(mocks.updateAgreement).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "billing.subscription_id_conflict" }),
    });
  });

  it("rejects metadata that would attach one Stripe subscription to a second agreement", async () => {
    mocks.txFindBySubscription.mockResolvedValue({ id: "agr-other" });
    const { ensureSubscriptionIdentityForWebhook } = await import(
      "@/domains/billing/subscription-identity"
    );

    await expect(
      ensureSubscriptionIdentityForWebhook(invoiceEvent("invoice.paid", "sub-1")),
    ).rejects.toThrow(/identity conflict/i);

    expect(mocks.updateAgreement).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "billing.subscription_id_conflict",
        entityId: "agr-1",
      }),
    });
  });

  it("leaves unrelated Stripe subscriptions alone when metadata has no agreement id", async () => {
    mocks.retrieveSubscription.mockResolvedValue({ id: "sub-1", metadata: {} });
    const { ensureSubscriptionIdentityForWebhook } = await import(
      "@/domains/billing/subscription-identity"
    );

    await ensureSubscriptionIdentityForWebhook(invoiceEvent("invoice.paid", "sub-1"));

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateAgreement).not.toHaveBeenCalled();
  });

  it("ignores webhook types that cannot carry recurring subscription identity", async () => {
    const { ensureSubscriptionIdentityForWebhook } = await import(
      "@/domains/billing/subscription-identity"
    );

    await ensureSubscriptionIdentityForWebhook(event("checkout.session.completed", { id: "cs-1" }));

    expect(mocks.findBySubscription).not.toHaveBeenCalled();
    expect(mocks.retrieveSubscription).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
