import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

// Real-money bug fixed 2026-09-27 (found by a code review, see
// docs/DECISIONS.md): ending or cancelling an agreement used to update
// only our own database — it never told Stripe to stop the recurring
// subscription, so a customer Chris considered "done" kept being billed
// every month. closeAgreement now cancels the Stripe subscription first,
// and only proceeds to update our own records if that succeeds (or the
// subscription was already gone on Stripe's side).

const findUniqueOrThrow = vi.fn();
const rentalLineFindMany = vi.fn();
const applianceAssignmentUpdate = vi.fn();
const applianceUpdate = vi.fn();
const rentalAgreementUpdate = vi.fn();
const auditLogCreate = vi.fn();
const subscriptionsCancel = vi.fn();

function makeTx() {
  return {
    rentalLine: { findMany: rentalLineFindMany },
    applianceAssignment: { update: applianceAssignmentUpdate },
    appliance: { update: applianceUpdate },
    rentalAgreement: { update: rentalAgreementUpdate },
    auditLog: { create: auditLogCreate },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: { findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrow(...args) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    subscriptions: { cancel: (...args: unknown[]) => subscriptionsCancel(...args) },
  }),
}));

describe("closeAgreement — stops the real Stripe subscription", () => {
  beforeEach(() => {
    findUniqueOrThrow.mockReset().mockResolvedValue({
      id: "agr-1",
      status: "ACTIVE",
      stripeSubscriptionId: "sub_123",
    });
    rentalLineFindMany.mockReset().mockResolvedValue([]);
    applianceAssignmentUpdate.mockReset().mockResolvedValue({});
    applianceUpdate.mockReset().mockResolvedValue({});
    rentalAgreementUpdate.mockReset().mockResolvedValue({ id: "agr-1", status: "ENDED" });
    auditLogCreate.mockReset().mockResolvedValue({});
    subscriptionsCancel.mockReset().mockResolvedValue({});
  });

  it("cancels the agreement's Stripe subscription before updating local records", async () => {
    const { endAgreement } = await import("@/domains/agreements");

    await endAgreement("user-1", "agr-1");

    expect(subscriptionsCancel).toHaveBeenCalledWith("sub_123");
    expect(rentalAgreementUpdate).toHaveBeenCalled();
  });

  it("skips the Stripe call entirely when the agreement never had a subscription (e.g. cancelled before ever being billed)", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "agr-1",
      status: "DRAFT",
      stripeSubscriptionId: null,
    });
    const { cancelAgreement } = await import("@/domains/agreements");

    await cancelAgreement("user-1", "agr-1");

    expect(subscriptionsCancel).not.toHaveBeenCalled();
    expect(rentalAgreementUpdate).toHaveBeenCalled();
  });

  it("proceeds with the local close when Stripe says the subscription is already gone", async () => {
    subscriptionsCancel.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: "No such subscription: 'sub_123'",
        code: "resource_missing",
        type: "invalid_request_error",
      }),
    );
    const { endAgreement } = await import("@/domains/agreements");

    await endAgreement("user-1", "agr-1");

    expect(rentalAgreementUpdate).toHaveBeenCalled();
  });

  it("blocks the whole close when Stripe fails for any other reason — never tells Chris it's ended while billing might still be running", async () => {
    subscriptionsCancel.mockRejectedValue(
      new Stripe.errors.StripeAPIError({
        message: "Stripe is temporarily unavailable",
        type: "api_error",
      }),
    );
    const { endAgreement } = await import("@/domains/agreements");

    await expect(endAgreement("user-1", "agr-1")).rejects.toThrow(
      "Stripe is temporarily unavailable",
    );
    expect(rentalAgreementUpdate).not.toHaveBeenCalled();
  });
});
