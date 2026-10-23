import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const updateMany = vi.fn();
const deliver = vi.fn();
const intentFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer:{findUnique:vi.fn().mockResolvedValue({preferredLanguage:"en",archivedAt:null})},
    subscriptionEndIntent: { findMany: (...args: unknown[]) => intentFindMany(...args) },
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
  terminationEffectiveOn?: Date | null;
  stripeSubscriptionId?: string | null;
}) {
  return {
    id: overrides.id,
    nextBillingDate: overrides.nextBillingDate,
    billingReminderSentForDate: overrides.billingReminderSentForDate ?? null,
    terminationEffectiveOn: overrides.terminationEffectiveOn ?? null,
    stripeSubscriptionId: overrides.stripeSubscriptionId ?? null,
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
    intentFindMany.mockReset().mockResolvedValue([]);
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

  it("sends no 'next bill' reminder when billing is set to stop on or before the bill date", async () => {
    const nextBillingDate = new Date("2026-10-01T12:00:00Z");
    findMany.mockResolvedValue([
      agreement({ id: "ends-first", nextBillingDate, stripeSubscriptionId: "sub_a" }),
      agreement({ id: "ends-later", nextBillingDate, stripeSubscriptionId: "sub_b" }),
      agreement({ id: "closed", nextBillingDate, stripeSubscriptionId: "sub_c" }),
      agreement({ id: "agreed-ending", nextBillingDate, terminationEffectiveOn: new Date("2026-09-30T12:00:00Z") }),
      agreement({ id: "renewal-continues", nextBillingDate, stripeSubscriptionId: "sub_d", terminationEffectiveOn: new Date("2026-09-30T12:00:00Z") }),
    ]);
    intentFindMany.mockResolvedValue([
      { stripeSubscriptionId: "sub_a", mode: "END_AT", cancelAt: new Date("2026-09-30T12:00:00Z") },
      { stripeSubscriptionId: "sub_b", mode: "END_AT", cancelAt: new Date("2026-11-01T12:00:00Z") },
      { stripeSubscriptionId: "sub_c", mode: "CLOSED", cancelAt: null },
      { stripeSubscriptionId: "sub_d", mode: "NO_END", cancelAt: null },
    ]);
    expect(await sendUpcomingBillingReminders()).toEqual({ sent: 2, failed: 0 });
    expect(deliver.mock.calls.map((c) => c[0].subject.id).sort()).toEqual(["ends-later", "renewal-continues"]);
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
