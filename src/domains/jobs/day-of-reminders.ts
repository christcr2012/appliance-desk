import { prisma } from "@/lib/prisma";
import { businessDateKey, businessDayBounds } from "@/lib/business-date";
import { deliverMessage } from "@/domains/messaging/deliver";

const JOB_TYPE_LABELS: Record<string, string> = {
  DELIVERY: "a delivery",
  INSTALLATION: "an installation",
  SWAP: "an appliance swap",
  REMOVAL: "a pickup",
  MAINTENANCE_VISIT: "a maintenance visit",
};

/** Claim first, then send. FAILED/NOT_SENT releases the claim; UNKNOWN keeps it
 * because the provider may already have accepted the text. */
export async function sendJobDayOfReminders(): Promise<{ sent: number; failed: number }> {
  const now = new Date();
  const { start, end } = businessDayBounds(now);
  const slot = businessDateKey(now);

  const jobs = await prisma.job.findMany({
    where: {
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      scheduledAt: { gte: start, lt: end },
      dayOfReminderSentAt: null,
      customer: { smsOptInAt: { not: null }, phone: { not: null } },
    },
    include: {
      customer: { select: { id: true, phone: true } },
      serviceAddress: true,
    },
  });

  let sent = 0;
  let failed = 0;

  for (const job of jobs) {
    if (!job.customer?.phone) continue;

    const claimed = await prisma.job.updateMany({
      where: {
        id: job.id,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        dayOfReminderSentAt: null,
      },
      data: { dayOfReminderSentAt: now },
    });
    if (claimed.count === 0) continue;

    const release = () =>
      prisma.job.updateMany({
        where: { id: job.id, dayOfReminderSentAt: now },
        data: { dayOfReminderSentAt: null },
      });

    const what = JOB_TYPE_LABELS[job.type] ?? "a visit";
    const where = job.serviceAddress ? ` at ${job.serviceAddress.line1}` : "";

    try {
      const delivery = await deliverMessage({
        idempotencyKey: `job-day-reminder-${job.id}-${slot}`,
        channel: "SMS",
        purpose: "TRANSACTIONAL",
        templateKey: "job-day-reminder",
        customerFacing: true,
        recipient: {
          type: "Customer",
          id: job.customer.id,
          address: job.customer.phone,
        },
        subject: { type: "Job", id: job.id },
        render: () => ({
          text: `Reminder: we have ${what} scheduled for you today${where}. Reply STOP to opt out of texts.`,
        }),
      });

      if (delivery.state === "FAILED" || delivery.state === "NOT_SENT") {
        await release();
        if (delivery.state === "FAILED") failed += 1;
        continue;
      }
      if (delivery.state === "ACCEPTED" || delivery.state === "DELIVERED") {
        sent += 1;
      } else if (delivery.state === "UNKNOWN") {
        failed += 1;
      }
    } catch (error) {
      await release().catch(() => undefined);
      console.error("[sms] Failed to record day-of job reminder", job.id, error);
      failed += 1;
    }
  }

  return { sent, failed };
}
