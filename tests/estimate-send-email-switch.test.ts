import { describe, it, expect, vi, beforeEach } from "vitest";

// sendEstimate tells the caller whether an email really went out, so the owner
// is told to share the link by hand when customer email is switched off.

const estimateFindUniqueOrThrow = vi.fn();
const transaction = vi.fn();
const sendEmail = vi.fn();

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
vi.mock("@/lib/customer-email", () => ({ sendCustomerEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/domains/settings", () => ({
  getBusinessSettings: vi.fn().mockResolvedValue({ publicBusinessName: "Robinson Appliance Rentals" }),
}));

import { sendEstimate } from "@/domains/estimates";

describe("sendEstimate and the customer email switch", () => {
  beforeEach(() => {
    transaction.mockReset().mockResolvedValue([]);
    sendEmail.mockReset();
    estimateFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "est-1",
      estimateNumber: 7,
      title: null,
      clientMessage: null,
      status: "DRAFT",
      lineItems: [{ monthlyPriceCents: 3000, oneTimePriceCents: 0, quantity: 1, billingType: "MONTHLY" }],
      customer: { user: { name: "Jane", email: "jane@example.com" } },
      lead: null,
    });
  });

  it("reports emailed: true when the email went out", async () => {
    sendEmail.mockResolvedValue({ sent: true });
    expect(await sendEstimate("u1", "est-1")).toEqual({ emailed: true });
  });

  it("reports emailed: false (estimate still marked sent) when customer email is off", async () => {
    sendEmail.mockResolvedValue({ sent: false });
    expect(await sendEstimate("u1", "est-1")).toEqual({ emailed: false });
    expect(transaction).toHaveBeenCalled();
  });
});
