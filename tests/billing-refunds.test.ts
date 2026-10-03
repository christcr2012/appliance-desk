import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (...args: unknown[]) => mocks.transaction(...args) },
}));
vi.mock("@/lib/stripe", () => ({ getStripeClient: vi.fn() }));
vi.mock("@/lib/team-actor", () => ({ assertActiveTeamActor: vi.fn() }));
vi.mock("@/domains/billing/provider-ops", () => ({
  claimProviderOperation: vi.fn(),
  completeProviderOperation: vi.fn(),
  runProviderCall: vi.fn(),
}));
vi.mock("@/domains/billing/ledger", () => ({ lockCustomerLedger: vi.fn() }));

import {
  decideDepositRefund,
  issueInvoiceRefund,
} from "@/domains/billing/refunds";

describe("billing refund input guards", () => {
  beforeEach(() => {
    mocks.transaction.mockReset();
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid deposit refund cents before starting a transaction: %s",
    async (refundCents) => {
      await expect(
        decideDepositRefund("owner-1", { depositId: "deposit-1", refundCents }),
      ).rejects.toThrow(/positive whole number of cents/i);
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it("fails closed when a caller supplies expectedVersion that the approved schema cannot verify", async () => {
    await expect(
      decideDepositRefund("owner-1", {
        depositId: "deposit-1",
        refundCents: 100,
        expectedVersion: 2,
      }),
    ).rejects.toThrow(/version checking is not available/i);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([0, -500, 2.25])(
    "rejects invalid invoice refund cents before starting a transaction: %s",
    async (amountCents) => {
      await expect(
        issueInvoiceRefund("owner-1", {
          invoiceId: "invoice-1",
          amountCents,
          reason: "OTHER",
        }),
      ).rejects.toThrow(/positive whole number of cents/i);
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
});
