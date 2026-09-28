import { describe, it, expect, vi, beforeEach } from "vitest";

// sendJobDayOfReminders (src/domains/jobs/day-of-reminders.ts, Task
// #71) — texts opted-in customers about a job scheduled today.

const jobFindMany = vi.fn();
const jobUpdate = vi.fn();
const sendSms = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    job: {
      findMany: (...args: unknown[]) => jobFindMany(...args),
      update: (...args: unknown[]) => jobUpdate(...args),
    },
  },
}));

vi.mock("@/lib/sms", () => ({
  sendSms: (...args: unknown[]) => sendSms(...args),
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
    customer: { id: `cust-${overrides.id}`, phone: overrides.phone ?? "3035550100" },
    serviceAddress: overrides.addressLine1 ? { line1: overrides.addressLine1 } : null,
  };
}

describe("sendJobDayOfReminders", () => {
  beforeEach(() => {
    jobFindMany.mockReset();
    jobUpdate.mockReset().mockResolvedValue({});
    sendSms.mockReset().mockResolvedValue({ sent: true });
  });

  it("texts every eligible job and marks it reminded", async () => {
    jobFindMany.mockResolvedValue([job({ id: "job-1", addressLine1: "100 Test St" })]);

    const result = await sendJobDayOfReminders();

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(sendSms).toHaveBeenCalledWith({
      to: "3035550100",
      body: expect.stringContaining("100 Test St"),
    });
    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { dayOfReminderSentAt: expect.any(Date) },
    });
  });

  it("reads naturally for a job type without a mapped label and no address", async () => {
    jobFindMany.mockResolvedValue([job({ id: "job-2", type: "MYSTERY_TYPE" })]);

    await sendJobDayOfReminders();

    const body = sendSms.mock.calls[0][0].body;
    expect(body).toContain("a visit");
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("null");
  });

  it("only queries opted-in customers with a phone number, jobs due today, not already reminded", async () => {
    jobFindMany.mockResolvedValue([]);

    await sendJobDayOfReminders();

    const query = jobFindMany.mock.calls[0][0];
    expect(query.where.status).toEqual({ in: ["SCHEDULED", "IN_PROGRESS"] });
    expect(query.where.dayOfReminderSentAt).toBeNull();
    expect(query.where.customer).toEqual({
      smsOptInAt: { not: null },
      phone: { not: null },
    });
    expect(query.where.scheduledAt.gte).toBeInstanceOf(Date);
    expect(query.where.scheduledAt.lt).toBeInstanceOf(Date);
  });

  it("counts a dormant/unconfigured Twilio send (sent: false) as failed, and never marks the job reminded", async () => {
    jobFindMany.mockResolvedValue([job({ id: "job-3" })]);
    sendSms.mockResolvedValue({ sent: false });

    const result = await sendJobDayOfReminders();

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(jobUpdate).not.toHaveBeenCalled();
  });

  it("keeps going for the rest of the batch when one job's send throws", async () => {
    jobFindMany.mockResolvedValue([job({ id: "job-4" }), job({ id: "job-5" })]);
    sendSms.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ sent: true });

    const result = await sendJobDayOfReminders();

    expect(result).toEqual({ sent: 1, failed: 1 });
  });
});
