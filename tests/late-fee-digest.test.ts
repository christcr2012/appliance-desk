import { formatCents } from "@/domains/pricing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deliverMessage = vi.fn();
const getBusinessSettings = vi.fn();
vi.mock("@/domains/messaging/deliver", () => ({ deliverMessage: (...args: unknown[]) => deliverMessage(...args) }));
vi.mock("@/domains/settings", () => ({ getBusinessSettings: (...args: unknown[]) => getBusinessSettings(...args) }));

describe("sendLateFeeDigestToChris", () => {
  beforeEach(() => {
    deliverMessage.mockReset().mockResolvedValue({ state: "ACCEPTED", deliveryId: "late-fee-digest", providerMessageId: "msg-1" });
    getBusinessSettings.mockReset().mockResolvedValue({ publicEmail: "chris@example.com" });
  });

  it("sends nothing when no fees were recorded", async () => {
    const { sendLateFeeDigestToChris } = await import("@/domains/billing/late-fees");
    await sendLateFeeDigestToChris([]);
    expect(deliverMessage).not.toHaveBeenCalled();
  });

  it("sends one idempotent note to Chris that says the fee goes on the next bill, not the late one", async () => {
    const { sendLateFeeDigestToChris } = await import("@/domains/billing/late-fees");
    await sendLateFeeDigestToChris([{ invoiceId: "inv-1", invoiceNumber: 1, customerName: "Pat Landlord", feeCents: 500 }]);
    expect(deliverMessage).toHaveBeenCalledTimes(1);
    const message = deliverMessage.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      idempotencyKey: expect.stringMatching(/^late-fee-digest-/),
      channel: "EMAIL",
      purpose: "TRANSACTIONAL",
      templateKey: "late-fee-digest",
      recipient: { type: "Staff", address: "chris@example.com" },
    });
    const text = message.render().text as string;
    expect(text).toContain("Pat Landlord");
    expect(text).toContain(formatCents(500));
    expect(text).toMatch(/next bill/);
  });
});
