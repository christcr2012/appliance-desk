import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const updateMany = vi.fn();
const deliver = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: {
      findMany: (...args: unknown[]) => findMany(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
  },
}));
vi.mock("@/domains/messaging/deliver", () => ({
  deliverMessage: (...args: unknown[]) => deliver(...args),
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
      id: `customer-${overrides.id}`,
      user: { name: "Jane Doe", email: overrides.email ?? "jane@example.com" },
    },
    invoices: overrides.amountDueCents == null ? [] : [{ amountDueCents: overrides.amountDueCents }],
  };
}

describe("sendUpcomingBillingReminders", () => {
  beforeEach(() => {
    findMany.mockReset();
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    deliver.mockReset().mockResolvedValue({ state: "ACCEPTED", deliveryId: "delivery", providerMessageId: "provider" });
  });

  it("claims the cycle before sending and records the business message", async () => {
    const nextBillingDate = new Date("2026-10-01T12:00:00Z");
    findMany.mockResolvedValue([agreement({ id: "agr-1", nextBillingDate, amountDueCents: 4000 })]);

    expect(await sendUpcomingBillingReminders()).toEqual({ sent: 1, failed: 0 });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    const message = deliver.mock.calls[0][0];
    expect(message).toMatchObject({
      idempotencyKey: `billing-reminder-agr-1-${nextBillingDate.getTime()}`,
      templateKey: "billing-reminder",
      recipient: { type: "Customer", id: "customer-agr-1", address: "jane@example.com" },
      subject: { type: "RentalAgreement", id: "agr-1" },
    });
    expect(message.render().text).toContain("$40");
  });

  it("skips a cycle already reminded", async () => {
    const cycle = new Date("2026-10-01T12:00:00Z");
    findMany.mockResolvedValue([agreement({ id: "agr-2", nextBillingDate: cycle, billingReminderSentForDate: cycle })]);
    expect(await sendUpcomingBillingReminders()).toEqual({ sent: 0, failed: 0 });
    expect(updateMany).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("releases the claim when sending is deliberately disabled", async () => {
    const cycle = new Date("2026-10-01T12:00:00Z");
    findMany.mockResolvedValue([agreement({ id: "agr-3", nextBillingDate: cycle })]);
    deliver.mockResolvedValue({ state: "NOT_SENT", deliveryId: "delivery", providerMessageId: null });
    expect(await sendUpcomingBillingReminders()).toEqual({ sent: 0, failed: 0 });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1][0]).toEqual({
      where: { id: "agr-3", billingReminderSentForDate: cycle },
      data: { billingReminderSentForDate: null },
    });
  });

  it("releases a definite provider failure but keeps UNKNOWN claimed", async () => {
    const cycle = new Date("2026-10-01T12:00:00Z");
    findMany.mockResolvedValue([agreement({ id: "failed", nextBillingDate: cycle })]);
    deliver.mockResolvedValue({ state: "FAILED", deliveryId: "d1", providerMessageId: null });
    expect(await sendUpcomingBillingReminders()).toEqual({ sent: 0, failed: 1 });
    expect(updateMany).toHaveBeenCalledTimes(2);

    updateMany.mockClear().mockResolvedValue({ count: 1 });
    findMany.mockResolvedValue([agreement({ id: "unknown", nextBillingDate: cycle })]);
    deliver.mockResolvedValue({ state: "UNKNOWN", deliveryId: "d2", providerMessageId: null });
    expect(await sendUpcomingBillingReminders()).toEqual({ sent: 0, failed: 1 });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("continues the batch when recording delivery throws", async () => {
    const cycle = new Date("2026-10-01T12:00:00Z");
    findMany.mockResolvedValue([
      agreement({ id: "one", nextBillingDate: cycle }),
      agreement({ id: "two", nextBillingDate: cycle }),
    ]);
    deliver.mockRejectedValueOnce(new Error("ledger unavailable")).mockResolvedValueOnce({ state: "ACCEPTED", deliveryId: "d2", providerMessageId: "p2" });
    expect(await sendUpcomingBillingReminders()).toEqual({ sent: 1, failed: 1 });
  });

  it("queries only active Stripe-subscribed agreements in the reminder window", async () => {
    findMany.mockResolvedValue([]);
    await sendUpcomingBillingReminders();
    const query = findMany.mock.calls[0][0];
    expect(query.where.status).toBe("ACTIVE");
    expect(query.where.stripeSubscriptionId).toEqual({ not: null });
    expect(query.where.nextBillingDate.gte).toBeInstanceOf(Date);
    expect(query.where.nextBillingDate.lte).toBeInstanceOf(Date);
  });
});
