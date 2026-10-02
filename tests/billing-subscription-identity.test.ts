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
  processCore: vi.fn(),
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

vi.mock("@/domains/billing/webhooks-core", () => ({
  processStripeWebhookEvent: (...args: unknown[]) => mocks.processCore(...args),
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
    mocks.processCore.mockResolvedValue(undefined);
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
    const webhook = invoiceEvent("invoice.paid", "sub-1");
    const { processStripeWebhookEvent } = await import("@/domains/billing/webhooks");

    await processStripeWebhookEvent(webhook);

    expect(mocks.retrieveSubscription).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.processCore).toHaveBeenCalledWith(webhook);
  });

  it("heals a missing subscription id from invoice subscription metadata before processing money", async () => {
    const webhook = invoiceEvent("invoice.paid", "sub-1");
    const { processStripeWebhookEvent } = await import("@/domains/billing/webhooks");

    await processStripeWebhookEvent(webhook);

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
    expect(mocks.processCore).toHaveBeenCalledWith(webhook);
  });

  it("uses metadata already present on subscription.deleted without another Stripe read", async () => {
    const webhook = deletedEvent("sub-1", "agr-1");
    const { processStripeWebhookEvent } = await import("@/domains/billing/webhooks");

    await processStripeWebhookEvent(webhook);

    expect(mocks.retrieveSubscription).not.toHaveBeenCalled();
    expect(mocks.updateAgreement).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { stripeSubscriptionId: "sub-1" },
    });
    expect(mocks.processCore).toHaveBeenCalledWith(webhook);
  });

  it("never overwrites a different subscription already linked to the metadata agreement", async () => {
    mocks.queryRaw.mockResolvedValue([{ id: "agr-1", stripeSubscriptionId: "sub-other" }]);
    const webhook = invoiceEvent("invoice.payment_failed", "sub-1");
    const { processStripeWebhookEvent } = await import("@/domains/billing/webhooks");

    await expect(processStripeWebhookEvent(webhook)).rejects.toThrow(/identity conflict/i);

    expect(mocks.updateAgreement).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "billing.subscription_id_conflict" }),
    });
    expect(mocks.processCore).not.toHaveBeenCalled();
  });

  it("rejects metadata that would attach one Stripe subscription to a second agreement", async () => {
    mocks.txFindBySubscription.mockResolvedValue({ id: "agr-other" });
    const webhook = invoiceEvent("invoice.paid", "sub-1");
    const { processStripeWebhookEvent } = await import("@/domains/billing/webhooks");

    await expect(processStripeWebhookEvent(webhook)).rejects.toThrow(/identity conflict/i);

    expect(mocks.updateAgreement).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "billing.subscription_id_conflict",
        entityId: "agr-1",
      }),
    });
    expect(mocks.processCore).not.toHaveBeenCalled();
  });

  it("leaves unrelated Stripe subscriptions alone when metadata has no agreement id", async () => {
    mocks.retrieveSubscription.mockResolvedValue({ id: "sub-1", metadata: {} });
    const webhook = invoiceEvent("invoice.paid", "sub-1");
    const { processStripeWebhookEvent } = await import("@/domains/billing/webhooks");

    await processStripeWebhookEvent(webhook);

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateAgreement).not.toHaveBeenCalled();
    expect(mocks.processCore).toHaveBeenCalledWith(webhook);
  });
});
