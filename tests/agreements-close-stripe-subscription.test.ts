import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

// Ending/cancelling an agreement must stop the Stripe subscription before
// declaring the local rental closed. Batch A also serializes the local state
// change on the agreement row so a concurrent lifecycle transition cannot be
// overwritten after the provider call returns.

const findUniqueOrThrow = vi.fn();
const rentalLineFindMany = vi.fn();
const applianceAssignmentUpdate = vi.fn();
const applianceUpdate = vi.fn();
const rentalAgreementUpdate = vi.fn();
const rentalAgreementFindUniqueOrThrowInTx = vi.fn();
const auditLogCreate = vi.fn();
const queryRaw = vi.fn();
const subscriptionsCancel = vi.fn();

function makeTx() {
  return {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    rentalLine: { findMany: rentalLineFindMany },
    applianceAssignment: { update: applianceAssignmentUpdate },
    appliance: { update: applianceUpdate },
    rentalAgreement: {
      update: rentalAgreementUpdate,
      findUniqueOrThrow: rentalAgreementFindUniqueOrThrowInTx,
    },
    auditLog: { create: auditLogCreate },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: {
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrow(...args),
    },
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
    queryRaw.mockReset().mockResolvedValue([{ id: "agr-1" }]);
    rentalLineFindMany.mockReset().mockResolvedValue([]);
    applianceAssignmentUpdate.mockReset().mockResolvedValue({});
    applianceUpdate.mockReset().mockResolvedValue({});
    rentalAgreementUpdate.mockReset().mockResolvedValue({ id: "agr-1" });
    // lockRentalAgreementInTx reads once before the update, and the return
    // value reads again after the update.
    rentalAgreementFindUniqueOrThrowInTx
      .mockReset()
      .mockResolvedValueOnce({
        id: "agr-1",
        status: "ACTIVE",
        endDate: null,
        stripeSubscriptionId: "sub_123",
      })
      .mockResolvedValue({
        id: "agr-1",
        status: "ENDED",
        endDate: new Date(),
        stripeSubscriptionId: "sub_123",
      });
    auditLogCreate.mockReset().mockResolvedValue({});
    subscriptionsCancel.mockReset().mockResolvedValue({});
  });

  it("cancels the agreement's Stripe subscription before updating local records", async () => {
    const { endAgreement } = await import("@/domains/agreements");

    await endAgreement("user-1", "agr-1");

    expect(subscriptionsCancel).toHaveBeenCalledWith("sub_123");
    expect(queryRaw).toHaveBeenCalled();
    expect(rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: expect.objectContaining({ status: "ENDED" }),
    });
  });

  it("skips Stripe when the agreement never had a subscription", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "agr-1",
      status: "DRAFT",
      stripeSubscriptionId: null,
    });
    rentalAgreementFindUniqueOrThrowInTx
      .mockReset()
      .mockResolvedValueOnce({
        id: "agr-1",
        status: "DRAFT",
        endDate: null,
        stripeSubscriptionId: null,
      })
      .mockResolvedValue({
        id: "agr-1",
        status: "CANCELLED",
        endDate: null,
        stripeSubscriptionId: null,
      });
    const { cancelAgreement } = await import("@/domains/agreements");

    await cancelAgreement("user-1", "agr-1");

    expect(subscriptionsCancel).not.toHaveBeenCalled();
    expect(rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: expect.objectContaining({ status: "CANCELLED" }),
    });
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

  it("blocks the whole close when Stripe fails for any other reason", async () => {
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
    expect(queryRaw).not.toHaveBeenCalled();
    expect(rentalAgreementUpdate).not.toHaveBeenCalled();
  });

  it("refuses the local close when the state changed during the provider call", async () => {
    rentalAgreementFindUniqueOrThrowInTx.mockReset().mockResolvedValue({
      id: "agr-1",
      status: "CANCELLED",
      endDate: null,
      stripeSubscriptionId: "sub_123",
    });
    const { endAgreement } = await import("@/domains/agreements");

    await expect(endAgreement("user-1", "agr-1")).rejects.toThrow(
      /changed by someone else/,
    );
    expect(subscriptionsCancel).toHaveBeenCalledWith("sub_123");
    expect(rentalAgreementUpdate).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });
});
