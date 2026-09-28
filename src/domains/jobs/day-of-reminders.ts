import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/sms";

// ---------------------------------------------------------------------------
// SMS day-of job reminders (Task #71, docs/DECISIONS.md 2026-09-28 —
// the growth brainstorm's own example of what SMS is actually good for:
// "your delivery window is today"). Runs from a daily Vercel Cron job
// (src/app/api/cron/job-reminders, vercel.json).
//
// Only reaches an opted-in customer with a phone number on file
// (Customer.smsOptInAt — see src/domains/portal's updateSmsPreference)
// — and, until Chris has a real Twilio phone number (waiting on his
// LLC's business texting registration), sendSms no-ops safely
// regardless, so this is fully wired up and dormant rather than half-
// built. Job.dayOfReminderSentAt stops the same job from being texted
// twice if the cron runs more than once while it's still scheduled
// today.
// ---------------------------------------------------------------------------

const JOB_TYPE_LABELS: Record<string, string> = {
  DELIVERY: "a delivery",
  INSTALLATION: "an installation",
  SWAP: "an appliance swap",
  REMOVAL: "a pickup",
  MAINTENANCE_VISIT: "a maintenance visit",
};

function startAndEndOfToday(now: Date): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Texts every opted-in customer with a job scheduled for today that
 * hasn't already been texted about. Best-effort per job — one failed
 * text never stops the rest from going out; returns a summary for the
 * cron route to log. */
export async function sendJobDayOfReminders(): Promise<{ sent: number; failed: number }> {
  const now = new Date();
  const { start, end } = startAndEndOfToday(now);

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
    if (!job.customer?.phone) continue; // narrows the type; the query above already guarantees this

    const what = JOB_TYPE_LABELS[job.type] ?? "a visit";
    const where = job.serviceAddress ? ` at ${job.serviceAddress.line1}` : "";

    try {
      // sendSms itself never throws (see its own doc comment) — it
      // returns { sent: false } for both "not configured yet" and a
      // real Twilio failure, so that's what's checked here, not a
      // caught exception.
      const result = await sendSms({
        to: job.customer.phone,
        body: `Reminder: we have ${what} scheduled for you today${where}. Reply STOP to opt out of texts.`,
      });
      if (!result.sent) {
        failed += 1;
        continue;
      }
      await prisma.job.update({
        where: { id: job.id },
        data: { dayOfReminderSentAt: now },
      });
      sent += 1;
    } catch (error) {
      console.error("[sms] Failed to send day-of job reminder", job.id, error);
      failed += 1;
    }
  }

  return { sent, failed };
}
