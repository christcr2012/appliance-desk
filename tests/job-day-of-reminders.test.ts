import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderDayOfJobReminder, previewDayOfReminder } from "@/domains/messaging/job-reminder-template";

const findMany = vi.fn();
const updateMany = vi.fn();
const deliver = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { job: { findMany: (...args: unknown[]) => findMany(...args),
    updateMany: (...args: unknown[]) => updateMany(...args) } },
}));
vi.mock("@/domains/messaging/deliver", () => ({
  deliverMessage: (...args: unknown[]) => deliver(...args),
}));

import { sendJobDayOfReminders } from "@/domains/jobs/day-of-reminders";

describe("COM-L6A job-day reminders cutover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([{ id:"j1", type:"DELIVERY" },
      { id:"j2", type:"REMOVAL" }]);
  });

  it("keeps verified-identity-sensitive cron messages held without claiming or sending", async () => {
    expect(await sendJobDayOfReminders()).toEqual({ sent: 0, failed: 0, heldForReview: 2 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ dayOfReminderSentAt: null,
        customer: { smsOptInAt: { not: null }, phone: { not: null } } }),
      take: 100,
    }));
    expect(updateMany).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("does not create false sent flags for an empty reminder period", async () => {
    findMany.mockResolvedValue([]);
    expect(await sendJobDayOfReminders()).toEqual({ sent: 0, failed: 0, heldForReview: 0 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("uses a bounded, shared reminder template and excludes private address data", () => {
    const rendered=renderDayOfJobReminder({ type:"DELIVERY", serviceAddress: {line1:"PRIVATE CUSTOMER ADDRESS"} },3);
    expect(rendered.text).toContain("a delivery");
    expect(rendered.text).toContain("Reply STOP");
    expect(rendered.text).not.toContain("PRIVATE CUSTOMER ADDRESS");
    expect(rendered.sms.segments).toBeGreaterThan(0);
    expect(renderDayOfJobReminder({ type:"UNRECOGNIZED" },3).text).toContain("a visit");
    const preview=previewDayOfReminder(10);
    expect(preview.sample.sms.costCents).toBeNull();
    expect(preview.sample.text).toContain("Robinson Appliance Rentals");
  });

  it("does not create work when read fails; errors surface for cron recovery", async () => {
    findMany.mockRejectedValueOnce(new Error("DB read failed"));
    await expect(sendJobDayOfReminders()).rejects.toThrow("DB read failed");
    expect(updateMany).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});
