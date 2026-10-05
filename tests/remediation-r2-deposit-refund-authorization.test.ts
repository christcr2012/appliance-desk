import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertActiveTeamActor: vi.fn(),
  resolveDepositRefundRail: vi.fn(),
}));

vi.mock("@/lib/team-actor", () => ({
  assertActiveTeamActor: (...args: unknown[]) => mocks.assertActiveTeamActor(...args),
}));
vi.mock("@/domains/billing/deposit-provenance", () => ({
  resolveDepositRefundRail: (...args: unknown[]) => mocks.resolveDepositRefundRail(...args),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown) => fn({}),
  },
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: vi.fn(),
}));
vi.mock("@/domains/billing/provider-ops", () => ({
  claimProviderOperation: vi.fn(),
  completeProviderOperation: vi.fn(),
  runProviderCall: vi.fn(),
}));

describe("R06 deposit refund authorization order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertActiveTeamActor.mockRejectedValue(
      new Error("This account no longer has access."),
    );
  });

  it("rejects an unauthorized actor before provenance recovery can mutate financial facts", async () => {
    const { decideDepositRefund } = await import("@/domains/billing/deposit-refunds");

    await expect(
      decideDepositRefund("staff-1", {
        depositId: "deposit-1",
        refundCents: 5_000,
      }),
    ).rejects.toThrow(/no longer has access/i);

    expect(mocks.assertActiveTeamActor).toHaveBeenCalledOnce();
    expect(mocks.resolveDepositRefundRail).not.toHaveBeenCalled();
  });
});
