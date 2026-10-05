import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const updateMany = vi.fn();
const deliver = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    job: {
      findMany: (...args: unknown[]) => findMany(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
  },
}));
vi.mock("@/domains/messaging/deliver", () => ({
  deliverMessage: (...args: unknown[]) => deliver(...args),
}));

import { sendJobDayOfReminders } from "@/domains/jobs/day-of-reminders";

function job(overrides: {
  id: string;
  type?: string;
  phone?: string | null;
  addressLine1?: string | null;
}) {
  return {
    id: overrides.id,
    type: overrides.type ?? "DELIVERY",
    customer: { id: `cust-${overrides.id}`, phone: overrides.phone ?? "+13035550100" },
    serviceAddress: overrides.addressLine1 ? { line1: overrides.addressLine1 } : null,
  };
}

describe("sendJobDayOfReminders", () => {
  beforeEach(() => {
    findMany.mockReset();
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    deliver.mockReset().mockResolvedValue({ state: "ACCEPTED", deliveryId: "delivery", providerMessageId: "SM1" });
  });

  it("claims the job first and records the SMS delivery", async () => {
    findMany.mockResolvedValue([job({ id: "job-1", addressLine1: "100 Test St" })]);
    expect(await sendJobDayOfReminders()).toEqual({ sent: 1, failed: 0 });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    const message = deliver.mock.calls[0][0];
    expect(message).toMatchObject({
      channel: "SMS",
      templateKey: "job-day-reminder",
      recipient: { type: "Customer", id: "cust-job-1", address: "+13035550100" },
      subject: { type: "Job", id: "job-1" },
    });
    expect(message.render().text).toContain("100 Test St");
  });

  it("reads naturally for an unmapped job type with no address", async () => {
    findMany.mockResolvedValue([job({ id: "job-2", type: "MYSTERY_TYPE" })]);
    await sendJobDayOfReminders();
    const body = deliver.mock.calls[0][0].render().text;
    expect(body).toContain("a visit");
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("null");
  });

  it("queries opted-in customers using Colorado business-day bounds", async () => {
    findMany.mockResolvedValue([]);
    await sendJobDayOfReminders();
    const query = findMany.mock.calls[0][0];
    expect(query.where.status).toEqual({ in: ["SCHEDULED", "IN_PROGRESS"] });
    expect(query.where.dayOfReminderSentAt).toBeNull();
    expect(query.where.customer).toEqual({ smsOptInAt: { not: null }, phone: { not: null } });
    expect(query.where.scheduledAt.gte).toBeInstanceOf(Date);
    expect(query.where.scheduledAt.lt).toBeInstanceOf(Date);
  });

  it("NOT_SENT releases the claim without reporting a provider failure", async () => {
    findMany.mockResolvedValue([job({ id: "job-3" })]);
    deliver.mockResolvedValue({ state: "NOT_SENT", deliveryId: "delivery", providerMessageId: null });
    expect(await sendJobDayOfReminders()).toEqual({ sent: 0, failed: 0 });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1][0]).toMatchObject({
      where: { id: "job-3", dayOfReminderSentAt: expect.any(Date) },
      data: { dayOfReminderSentAt: null },
    });
  });

  it("FAILED releases the claim while UNKNOWN keeps it", async () => {
    findMany.mockResolvedValue([job({ id: "failed" })]);
    deliver.mockResolvedValue({ state: "FAILED", deliveryId: "d1", providerMessageId: null });
    expect(await sendJobDayOfReminders()).toEqual({ sent: 0, failed: 1 });
    expect(updateMany).toHaveBeenCalledTimes(2);

    updateMany.mockClear().mockResolvedValue({ count: 1 });
    findMany.mockResolvedValue([job({ id: "unknown" })]);
    deliver.mockResolvedValue({ state: "UNKNOWN", deliveryId: "d2", providerMessageId: null });
    expect(await sendJobDayOfReminders()).toEqual({ sent: 0, failed: 1 });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
