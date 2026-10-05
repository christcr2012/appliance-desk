import { describe, it, expect, vi, beforeEach } from "vitest";

// sendEstimate tells the caller whether an email really went out, so the owner
// is told to share the link by hand when customer email is switched off.

const estimateFindUniqueOrThrow = vi.fn();
const transaction = vi.fn();
const tx = {
  $queryRaw: vi.fn(),
  estimate: {
    findUniqueOrThrow: (...a: unknown[]) => estimateFindUniqueOrThrow(...a),
    update: vi.fn(),
  },
  auditLog: { create: vi.fn() },
};
const deliverMessage = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    estimate: {
      findUniqueOrThrow: (...a: unknown[]) => estimateFindUniqueOrThrow(...a),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("@/domains/messaging/deliver", () => ({
  deliverMessage: (...a: unknown[]) => deliverMessage(...a),
}));
vi.mock("@/domains/settings", () => ({
  getBusinessSettings: vi.fn().mockResolvedValue({
    publicBusinessName: "Robinson Appliance Rentals",
  }),
}));

import { sendEstimate } from "@/domains/estimates";

describe("sendEstimate and the customer email switch", () => {
  beforeEach(() => {
    tx.$queryRaw.mockReset().mockResolvedValue([{ id: "est-1" }]);
    transaction
      .mockReset()
      .mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    deliverMessage.mockReset();
    estimateFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "est-1",
      estimateNumber: 7,
      title: null,
      clientMessage: null,
      status: "DRAFT",
      lineItems: [
        {
          monthlyPriceCents: 3000,
          oneTimePriceCents: 0,
          quantity: 1,
          billingType: "MONTHLY",
        },
      ],
      customer: {
        user: { name: "Jane", email: "jane@example.com" },
      },
      lead: null,
    });
  });

  it("reports emailed: true when the provider accepted the email", async () => {
    deliverMessage.mockResolvedValue({
      state: "ACCEPTED",
      deliveryId: "delivery-1",
      providerMessageId: "email-1",
    });
    expect(await sendEstimate("u1", "est-1")).toEqual({
      emailed: true,
      outcome: "SENT",
    });
  });

  it("reports emailed: false (estimate still marked sent) when customer email is off", async () => {
    deliverMessage.mockResolvedValue({
      state: "NOT_SENT",
      deliveryId: "delivery-2",
      providerMessageId: null,
    });
    expect(await sendEstimate("u1", "est-1")).toEqual({
      emailed: false,
      outcome: "NOT_ATTEMPTED",
    });
    expect(transaction).toHaveBeenCalled();
  });
});
