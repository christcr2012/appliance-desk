import { describe, it, expect, vi, beforeEach } from "vitest";

// Billing reminders (Task #67, docs/DECISIONS.md 2026-09-28, "Automation
// rules") — src/domains/billing/reminders.ts. Driven off
// RentalAgreement.nextBillingDate (kept current by the Stripe webhook, see
// tests/billing-webhooks.test.ts for that side) with no live Stripe call
// of its own, so only prisma and the email helper need mocking here.

const rentalAgreementFindMany = vi.fn();
const rentalAgreementUpdate = vi.fn();
const sendEmail = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: {
      findMany: (...args: unknown[]) => rentalAgreementFindMany(...args),
      update: (...args: unknown[]) => rentalAgreementUpdate(...args),
    },
  },
}));

vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

import { sendUpcomingBillingReminders } from "@/domains/billing/reminders";

function agreement(overrides: {
  id: string;
  nextBillingDate: Date;
  billingReminderSentForDate?: Date | null;
  email?: string;
  amountDueCents?: number | null;
}) {
  return {
    id: overrides.id,
    nextBillingDate: overrides.nextBillingDate,
    billingReminderSentForDate: overrides.billingReminderSentForDate ?? null,
    customer: {
      user: { name: "Jane Doe", email: overrides.email ?? "jane@example.com" },
    },
    invoices:
      overrides.amountDueCents == null ? [] : [{ amountDueCents: overrides.amountDueCents }],
  };
}

describe("sendUpcomingBillingReminders", () => {
  beforeEach(() => {
    rentalAgreementFindMany.mockReset();
    rentalAgreementUpdate.mockReset().mockResolvedValue({});
    sendEmail.mockReset().mockResolvedValue({ sent: true });
  });

  it("emails every agreement due within the reminder window and records which cycle it was sent for", async () => {
    const nextBillingDate = new Date("2026-10-01");
    rentalAgreementFindMany.mockResolvedValue([
      agreement({ id: "agr-1", nextBillingDate, amountDueCents: 4000 }),
    ]);

    const result = await sendUpcomingBillingReminders();

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = sendEmail.mock.calls[0][0];
    expect(call.to).toBe("jane@example.com");
    expect(call.text).toContain("$40");
    expect(rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-1" },
      data: { billingReminderSentForDate: nextBillingDate },
    });
  });

  it("skips an agreement already reminded for this exact billing cycle", async () => {
    const nextBillingDate = new Date("2026-10-01");
    rentalAgreementFindMany.mockResolvedValue([
      agreement({ id: "agr-2", nextBillingDate, billingReminderSentForDate: nextBillingDate }),
    ]);

    const result = await sendUpcomingBillingReminders();

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(rentalAgreementUpdate).not.toHaveBeenCalled();
  });

  it("re-arms once nextBillingDate has moved to a new cycle, even if a past cycle was already reminded", async () => {
    const oldCycle = new Date("2026-09-01");
    const newCycle = new Date("2026-10-01");
    rentalAgreementFindMany.mockResolvedValue([
      agreement({ id: "agr-3", nextBillingDate: newCycle, billingReminderSentForDate: oldCycle }),
    ]);

    const result = await sendUpcomingBillingReminders();

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("sends without an amount when there's no prior invoice to approximate from, rather than guessing", async () => {
    rentalAgreementFindMany.mockResolvedValue([
      agreement({ id: "agr-4", nextBillingDate: new Date("2026-10-01"), amountDueCents: null }),
    ]);

    await sendUpcomingBillingReminders();

    const call = sendEmail.mock.calls[0][0];
    expect(call.text).not.toContain("approximately");
    expect(call.text).not.toContain("$");
  });

  it("keeps sending to the rest of the batch when one agreement's email fails", async () => {
    sendEmail
      .mockRejectedValueOnce(new Error("Resend is down"))
      .mockResolvedValueOnce({ sent: true });
    rentalAgreementFindMany.mockResolvedValue([
      agreement({ id: "agr-5", nextBillingDate: new Date("2026-10-01"), amountDueCents: 1000 }),
      agreement({ id: "agr-6", nextBillingDate: new Date("2026-10-02"), amountDueCents: 2000 }),
    ]);

    const result = await sendUpcomingBillingReminders();

    expect(result).toEqual({ sent: 1, failed: 1 });
    // The failed one's dedup field is never written, so a retry next run
    // will try again instead of silently skipping it forever.
    expect(rentalAgreementUpdate).toHaveBeenCalledTimes(1);
    expect(rentalAgreementUpdate).toHaveBeenCalledWith({
      where: { id: "agr-6" },
      data: { billingReminderSentForDate: new Date("2026-10-02") },
    });
  });

  it("queries only ACTIVE, Stripe-subscribed agreements due within the window", async () => {
    rentalAgreementFindMany.mockResolvedValue([]);

    await sendUpcomingBillingReminders();

    const query = rentalAgreementFindMany.mock.calls[0][0];
    expect(query.where.status).toBe("ACTIVE");
    expect(query.where.stripeSubscriptionId).toEqual({ not: null });
    expect(query.where.nextBillingDate.gte).toBeInstanceOf(Date);
    expect(query.where.nextBillingDate.lte).toBeInstanceOf(Date);
  });
});
