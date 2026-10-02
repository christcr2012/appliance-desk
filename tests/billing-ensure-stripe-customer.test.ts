import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  state: { stripeCustomerId: null as string | null },
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  customerFind: vi.fn(),
  customerUpdate: vi.fn(),
  customerCreate: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  runProviderCall: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => m.transaction(...args),
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({ customers: { create: (...args: unknown[]) => m.customerCreate(...args) } }),
}));

vi.mock("@/domains/referrals", () => ({ rewardReferralIfEligible: vi.fn() }));

vi.mock("@/domains/billing/provider-ops", () => ({
  claimProviderOperation: (...args: unknown[]) => m.claim(...args),
  completeProviderOperation: (...args: unknown[]) => m.complete(...args),
  runProviderCall: (...args: unknown[]) => m.runProviderCall(...args),
}));

function makeTx() {
  return {
    $queryRaw: (...args: unknown[]) => m.queryRaw(...args),
    customer: {
      findUniqueOrThrow: (...args: unknown[]) => m.customerFind(...args),
      update: (...args: unknown[]) => m.customerUpdate(...args),
    },
  };
}

describe("ensureStripeCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.state.stripeCustomerId = null;
    m.queryRaw.mockImplementation(async () => [
      { id: "customer-1", stripeCustomerId: m.state.stripeCustomerId },
    ]);
    m.customerFind.mockResolvedValue({
      id: "customer-1",
      stripeCustomerId: null,
      user: { name: "Test Customer", email: "customer@example.test" },
    });
    m.customerUpdate.mockImplementation(async (args: { data: { stripeCustomerId?: string | null } }) => {
      if ("stripeCustomerId" in args.data) m.state.stripeCustomerId = args.data.stripeCustomerId ?? null;
      return { id: "customer-1", stripeCustomerId: m.state.stripeCustomerId };
    });
    m.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(makeTx()));
    m.claim.mockResolvedValue({
      done: false,
      opId: "op-1",
      idempotencyKey: "customer-create-customer-1",
    });
    m.complete.mockResolvedValue(undefined);
    m.customerCreate.mockResolvedValue({ id: "cus_new" });
    m.runProviderCall.mockImplementation(async (call: () => Promise<unknown>) => ({
      ok: true,
      value: await call(),
    }));
  });

  it("returns an existing Stripe customer without claiming or calling Stripe", async () => {
    m.state.stripeCustomerId = "cus_existing";
    const { ensureStripeCustomer } = await import("@/domains/billing/checkout");

    await expect(ensureStripeCustomer("customer-1")).resolves.toBe("cus_existing");
    expect(m.claim).not.toHaveBeenCalled();
    expect(m.customerCreate).not.toHaveBeenCalled();
  });

  it("creates once, persists the id, and reuses it on the next call", async () => {
    const { ensureStripeCustomer } = await import("@/domains/billing/checkout");

    await expect(ensureStripeCustomer("customer-1")).resolves.toBe("cus_new");
    expect(m.customerCreate).toHaveBeenCalledTimes(1);
    expect(m.customerCreate).toHaveBeenCalledWith(
      {
        name: "Test Customer",
        email: "customer@example.test",
        metadata: { customerId: "customer-1" },
      },
      { idempotencyKey: "customer-create-customer-1" },
    );
    expect(m.complete).toHaveBeenCalledWith(
      expect.anything(),
      "op-1",
      { status: "SUCCEEDED", providerObjectId: "cus_new" },
    );
    expect(m.state.stripeCustomerId).toBe("cus_new");

    await expect(ensureStripeCustomer("customer-1")).resolves.toBe("cus_new");
    expect(m.customerCreate).toHaveBeenCalledTimes(1);
  });

  it("heals a missing local link from an already-succeeded provider operation", async () => {
    m.claim.mockResolvedValue({ done: true, providerObjectId: "cus_recovered" });
    const { ensureStripeCustomer } = await import("@/domains/billing/checkout");

    await expect(ensureStripeCustomer("customer-1")).resolves.toBe("cus_recovered");
    expect(m.customerCreate).not.toHaveBeenCalled();
    expect(m.state.stripeCustomerId).toBe("cus_recovered");
  });

  it("records UNKNOWN and throws a safe retry message when the provider outcome is ambiguous", async () => {
    const connectionError = new Error("socket closed after send");
    m.runProviderCall.mockResolvedValue({ ok: false, outcome: "UNKNOWN", error: connectionError });
    const { ensureStripeCustomer } = await import("@/domains/billing/checkout");

    await expect(ensureStripeCustomer("customer-1")).rejects.toThrow(
      "Couldn't set up billing for this customer — try again in a minute.",
    );
    expect(m.complete).toHaveBeenCalledWith(
      expect.anything(),
      "op-1",
      { status: "UNKNOWN", error: connectionError },
    );
    expect(m.state.stripeCustomerId).toBeNull();
  });

  it("keeps an existing local provider link and records DRIFT instead of overwriting it", async () => {
    m.customerCreate.mockImplementation(async () => {
      m.state.stripeCustomerId = "cus_other_worker";
      return { id: "cus_this_call" };
    });
    const { ensureStripeCustomer } = await import("@/domains/billing/checkout");

    await expect(ensureStripeCustomer("customer-1")).resolves.toBe("cus_other_worker");
    expect(m.state.stripeCustomerId).toBe("cus_other_worker");
    expect(m.complete).toHaveBeenCalledWith(
      expect.anything(),
      "op-1",
      expect.objectContaining({ status: "DRIFT", providerObjectId: "cus_this_call" }),
    );
  });
});
