import { describe, it, expect, vi, beforeEach } from "vitest";

// Automatic follow-up on a sent-but-unanswered estimate (2026-09-29) —
// src/domains/estimates's sendEstimateFollowUpReminders. Same mocked-
// prisma approach as tests/billing-reminders.test.ts (the pattern this
// copies): no live database or Stripe call in this function, so prisma,
// the email helper, and getBusinessSettings are the only things that
// need faking.

const estimateFindMany = vi.fn();
const estimateUpdate = vi.fn();
const sendEmail = vi.fn();
const getBusinessSettings = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    estimate: {
      findMany: (...args: unknown[]) => estimateFindMany(...args),
      update: (...args: unknown[]) => estimateUpdate(...args),
    },
  },
}));

vi.mock("@/lib/customer-email", () => ({
  sendCustomerEmail: (...args: unknown[]) => sendEmail(...args),
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
    estimateUpdate.mockReset().mockResolvedValue({});
    sendEmail.mockReset().mockResolvedValue({ sent: true });
    getBusinessSettings.mockReset().mockResolvedValue({ publicBusinessName: "Robinson Appliance Rentals" });
  });

  it("emails every SENT/VIEWED estimate the query returns and records which sentAt cycle it was sent for", async () => {
    const sentAt = new Date("2026-09-20T00:00:00Z");
    estimateFindMany.mockResolvedValue([
      estimate({ id: "est-1", sentAt, customerEmail: "jane@example.com" }),
    ]);

    const result = await sendEstimateFollowUpReminders();

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe("jane@example.com");
    expect(estimateUpdate).toHaveBeenCalledWith({
      where: { id: "est-1" },
      data: { followUpSentForSentAt: sentAt },
    });
  });

  it("skips an estimate already followed up on for its current sentAt", async () => {
    const sentAt = new Date("2026-09-20T00:00:00Z");
    estimateFindMany.mockResolvedValue([
      estimate({ id: "est-1", sentAt, followUpSentForSentAt: sentAt, customerEmail: "jane@example.com" }),
    ]);

    const result = await sendEstimateFollowUpReminders();

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends a fresh follow-up when the estimate was re-sent (a new sentAt) after an earlier follow-up cycle", async () => {
    const oldSentAt = new Date("2026-09-10T00:00:00Z");
    const newSentAt = new Date("2026-09-20T00:00:00Z");
    estimateFindMany.mockResolvedValue([
      estimate({ id: "est-1", sentAt: newSentAt, followUpSentForSentAt: oldSentAt, customerEmail: "jane@example.com" }),
    ]);

    const result = await sendEstimateFollowUpReminders();

    expect(result).toEqual({ sent: 1, failed: 0 });
  });

  it("uses the lead's email when the estimate hasn't converted to a customer yet", async () => {
    const sentAt = new Date("2026-09-20T00:00:00Z");
    estimateFindMany.mockResolvedValue([
      estimate({ id: "est-1", sentAt, leadEmail: "lead@example.com" }),
    ]);

    await sendEstimateFollowUpReminders();

    expect(sendEmail.mock.calls[0][0].to).toBe("lead@example.com");
  });

  it("counts a failed send without stopping the rest", async () => {
    const sentAt = new Date("2026-09-20T00:00:00Z");
    estimateFindMany.mockResolvedValue([
      estimate({ id: "est-1", sentAt, customerEmail: "jane@example.com" }),
      estimate({ id: "est-2", sentAt, customerEmail: "john@example.com" }),
    ]);
    sendEmail.mockRejectedValueOnce(new Error("Resend is down")).mockResolvedValueOnce({ sent: true });

    const result = await sendEstimateFollowUpReminders();

    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(estimateUpdate).toHaveBeenCalledTimes(1);
  });
});
