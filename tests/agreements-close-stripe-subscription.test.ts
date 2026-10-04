import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  claimProviderOperation: vi.fn(),
  completeProviderOperation: vi.fn(),
  runProviderCall: vi.fn(),
  rentalLineFindMany: vi.fn(),
  applianceAssignmentUpdate: vi.fn(),
  applianceFindUniqueOrThrow: vi.fn(),
  applianceUpdate: vi.fn(),
  rentalAgreementUpdate: vi.fn(),
  rentalAgreementFindUniqueOrThrow: vi.fn(),
  auditLogCreate: vi.fn(),
  queryRaw: vi.fn(),
  subscriptionsCancel: vi.fn(),
}));

function makeTx() {
  return {
    $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args),
    rentalLine: { findMany: mocks.rentalLineFindMany },
    applianceAssignment: { update: mocks.applianceAssignmentUpdate },
    appliance: {
      findUniqueOrThrow: mocks.applianceFindUniqueOrThrow,
      update: mocks.applianceUpdate,
    },
    rentalAgreement: {
      update: async (...args: unknown[]) => {
        mocks.events.push("local-update");
        return mocks.rentalAgreementUpdate(...args);
      },
      findUniqueOrThrow: mocks.rentalAgreementFindUniqueOrThrow,
      // closeAgreement checks for a signed renewal waiting to start: none here.
      findFirst: async () => null,
    },
    // Ending an agreement also cancels a swap still waiting for it: none here.
    job: { findMany: async () => [] },
    auditLog: { create: mocks.auditLogCreate },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    subscriptions: {
      cancel: async (...args: unknown[]) => {
        mocks.events.push("stripe-cancel");
        return mocks.subscriptionsCancel(...args);
      },
    },
  }),
}));

vi.mock("@/domains/billing/provider-ops", () => ({
  claimProviderOperation: (...args: unknown[]) =>
    mocks.claimProviderOperation(...args),
  completeProviderOperation: (...args: unknown[]) =>
    mocks.completeProviderOperation(...args),
  runProviderCall: (...args: unknown[]) => mocks.runProviderCall(...args),
}));

async function providerCallWrapper(call: () => Promise<unknown>) {
  try {
    return { ok: true as const, value: await call() };
  } catch (error) {
    const type = (error as { type?: string }).type;
    return {
      ok: false as const,
      outcome:
        type === "StripeConnectionError" || type === "StripeAPIError"
          ? ("UNKNOWN" as const)
          : ("FAILED" as const),
      error,
    };
  }
}

describe("closeAgreement — durable provider cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.queryRaw.mockResolvedValue([{ id: "agr-1" }]);
    mocks.rentalLineFindMany.mockResolvedValue([]);
    mocks.applianceAssignmentUpdate.mockResolvedValue({});
    mocks.applianceFindUniqueOrThrow.mockResolvedValue({ status: "RENTED" });
    mocks.applianceUpdate.mockResolvedValue({});
    mocks.rentalAgreementUpdate.mockResolvedValue({ id: "agr-1" });
    mocks.rentalAgreementFindUniqueOrThrow
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
    mocks.auditLogCreate.mockResolvedValue({});
    mocks.claimProviderOperation.mockResolvedValue({
      done: false,
      opId: "op-cancel-1",
      idempotencyKey: "subscription-cancel-agr-1",
    });
    mocks.completeProviderOperation.mockResolvedValue(undefined);
    mocks.subscriptionsCancel.mockResolvedValue({ id: "sub_123", status: "canceled" });
    mocks.runProviderCall.mockImplementation(providerCallWrapper);
  });

  it("commits the local close before calling Stripe", async () => {
    const { endAgreement } = await import("@/domains/agreements");

    const result = await endAgreement("user-1", "agr-1");

    expect(result.status).toBe("ENDED");
    expect(mocks.claimProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      {
        kind: "SUBSCRIPTION_CANCEL",
        subjectType: "RentalAgreement",
        subjectId: "agr-1",
        idempotencyKey: "subscription-cancel-agr-1",
      },
    );
    expect(mocks.events.indexOf("local-update")).toBeGreaterThanOrEqual(0);
    expect(mocks.events.indexOf("stripe-cancel")).toBeGreaterThan(
      mocks.events.indexOf("local-update"),
    );
    expect(mocks.completeProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      "op-cancel-1",
      { status: "SUCCEEDED", providerObjectId: "sub_123" },
    );
  });

  it("closes locally even when Stripe has an ambiguous failure and records UNKNOWN", async () => {
    mocks.subscriptionsCancel.mockRejectedValue({
      type: "StripeConnectionError",
      message: "simulated connection loss",
    });
    const { endAgreement } = await import("@/domains/agreements");

    const result = await endAgreement("user-1", "agr-1");

    expect(result.status).toBe("ENDED");
    expect(mocks.rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: expect.objectContaining({ status: "ENDED" }),
    });
    expect(mocks.completeProviderOperation).toHaveBeenCalledWith(
      expect.anything(),
      "op-cancel-1",
      expect.objectContaining({ status: "UNKNOWN" }),
    );
  });

  it("skips provider work when an agreement never had a Stripe subscription", async () => {
    mocks.rentalAgreementFindUniqueOrThrow
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

    const result = await cancelAgreement("user-1", "agr-1");

    expect(result.status).toBe("CANCELLED");
    expect(mocks.claimProviderOperation).not.toHaveBeenCalled();
    expect(mocks.subscriptionsCancel).not.toHaveBeenCalled();
  });

  it("does not re-call Stripe when a previously completed cancel claim is returned", async () => {
    mocks.claimProviderOperation.mockResolvedValue({
      done: true,
      providerObjectId: "sub_123",
    });
    const { endAgreement } = await import("@/domains/agreements");

    await endAgreement("user-1", "agr-1");

    expect(mocks.subscriptionsCancel).not.toHaveBeenCalled();
  });
});
