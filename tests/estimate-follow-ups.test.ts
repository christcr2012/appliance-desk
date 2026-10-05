import { describe, it, expect, vi, beforeEach } from "vitest";

const estimateFindMany = vi.fn();
const estimateUpdateMany = vi.fn();
const deliver = vi.fn();
const getBusinessSettings = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    estimate: {
      findMany: (...args: unknown[]) => estimateFindMany(...args),
      updateMany: (...args: unknown[]) => estimateUpdateMany(...args),
    },
  },
}));
vi.mock("@/domains/messaging/deliver", () => ({
  deliverMessage: (...args: unknown[]) => deliver(...args),
}));
vi.mock("@/domains/settings", () => ({
  getBusinessSettings: (...args: unknown[]) => getBusinessSettings(...args),
}));

import { sendEstimateFollowUpReminders } from "@/domains/estimates";

function estimate(overrides: {
  id: string;
  estimateNumber?: number;
  sentAt: Date;
  followUpSentForSentAt?: Date | null;
  status?: "SENT" | "VIEWED";
  customerEmail?: string | null;
  leadEmail?: string | null;
}) {
  return {
    id: overrides.id,
    estimateNumber: overrides.estimateNumber ?? 1,
    title: "Test estimate",
    status: overrides.status ?? "SENT",
    sentAt: overrides.sentAt,
    followUpSentForSentAt: overrides.followUpSentForSentAt ?? null,
    customer: overrides.customerEmail
      ? { user: { name: "Jane Doe", email: overrides.customerEmail } }
      : null,
    lead: overrides.leadEmail ? { contactName: "Jane Lead", email: overrides.leadEmail } : null,
  };
}

describe("sendEstimateFollowUpReminders", () => {
  beforeEach(() => {
    estimateFindMany.mockReset();
    estimateUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    deliver.mockReset().mockResolvedValue({ state: "ACCEPTED", deliveryId: "delivery", providerMessageId: "provider" });
    getBusinessSettings.mockReset().mockResolvedValue({ publicBusinessName: "Robinson Appliance Rentals" });
  });

  it("records the claim and sends through the durable delivery boundary", async () => {
    const sentAt = new Date("2026-09-20T00:00:00Z");
    estimateFindMany.mockResolvedValue([estimate({ id: "est-1", sentAt, customerEmail: "jane@example.com" })]);

    expect(await sendEstimateFollowUpReminders()).toEqual({ sent: 1, failed: 0 });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0]).toMatchObject({
      idempotencyKey: `estimate-follow-up-est-1-${sentAt.getTime()}`,
      templateKey: "estimate-follow-up",
      recipient: { type: "Customer", address: "jane@example.com" },
      subject: { type: "Estimate", id: "est-1" },
    });
    expect(estimateUpdateMany).toHaveBeenCalledTimes(1);
    expect(estimateUpdateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: "est-1", sentAt },
      data: { followUpSentForSentAt: sentAt },
    });
  });

  it("skips an estimate already followed up on for its current sentAt", async () => {
    const sentAt = new Date("2026-09-20T00:00:00Z");
    estimateFindMany.mockResolvedValue([
      estimate({ id: "est-1", sentAt, followUpSentForSentAt: sentAt, customerEmail: "jane@example.com" }),
    ]);
    expect(await sendEstimateFollowUpReminders()).toEqual({ sent: 0, failed: 0 });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("sends a fresh follow-up when a re-send has a new sentAt", async () => {
    const oldSentAt = new Date("2026-09-10T00:00:00Z");
    const newSentAt = new Date("2026-09-20T00:00:00Z");
    estimateFindMany.mockResolvedValue([
      estimate({ id: "est-1", sentAt: newSentAt, followUpSentForSentAt: oldSentAt, customerEmail: "jane@example.com" }),
    ]);
    expect(await sendEstimateFollowUpReminders()).toEqual({ sent: 1, failed: 0 });
  });

  it("uses the lead address before conversion", async () => {
    const sentAt = new Date("2026-09-20T00:00:00Z");
    estimateFindMany.mockResolvedValue([estimate({ id: "est-1", sentAt, leadEmail: "lead@example.com" })]);
    await sendEstimateFollowUpReminders();
    expect(deliver.mock.calls[0][0]).toMatchObject({
      recipient: { type: "Lead", address: "lead@example.com" },
    });
  });

  it("releases the claim and continues when recording/sending throws", async () => {
    const sentAt = new Date("2026-09-20T00:00:00Z");
    estimateFindMany.mockResolvedValue([
      estimate({ id: "est-1", sentAt, customerEmail: "jane@example.com" }),
      estimate({ id: "est-2", sentAt, customerEmail: "john@example.com" }),
    ]);
    deliver.mockRejectedValueOnce(new Error("ledger unavailable")).mockResolvedValueOnce({ state: "ACCEPTED", deliveryId: "d2", providerMessageId: "p2" });
    expect(await sendEstimateFollowUpReminders()).toEqual({ sent: 1, failed: 1 });
    expect(estimateUpdateMany).toHaveBeenCalledTimes(3);
  });

  it("releases the claim when customer email is deliberately NOT_SENT", async () => {
    const sentAt = new Date("2026-09-20T00:00:00Z");
    estimateFindMany.mockResolvedValue([estimate({ id: "est-1", sentAt, customerEmail: "jane@example.com" })]);
    deliver.mockResolvedValue({ state: "NOT_SENT", deliveryId: "delivery", providerMessageId: null });
    expect(await sendEstimateFollowUpReminders()).toEqual({ sent: 0, failed: 0 });
    expect(estimateUpdateMany).toHaveBeenCalledTimes(2);
    expect(estimateUpdateMany.mock.calls[1]![0]).toEqual({
      where: { id: "est-1", followUpSentForSentAt: sentAt },
      data: { followUpSentForSentAt: null },
    });
  });

  it("does not send when another run already claimed this estimate", async () => {
    const sentAt = new Date("2026-09-20T00:00:00Z");
    estimateFindMany.mockResolvedValue([estimate({ id: "est-1", sentAt, customerEmail: "jane@example.com" })]);
    estimateUpdateMany.mockResolvedValue({ count: 0 });
    expect(await sendEstimateFollowUpReminders()).toEqual({ sent: 0, failed: 0 });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("keeps the claim after an UNKNOWN outcome so a lost response is never emailed twice", async () => {
    const sentAt = new Date("2026-09-20T00:00:00Z");
    estimateFindMany.mockResolvedValue([estimate({ id: "est-1", sentAt, customerEmail: "jane@example.com" })]);
    deliver.mockResolvedValue({ state: "UNKNOWN", deliveryId: "delivery", providerMessageId: null });
    expect(await sendEstimateFollowUpReminders()).toEqual({ sent: 0, failed: 1 });
    expect(estimateUpdateMany).toHaveBeenCalledTimes(1);
  });
});
