import { prisma } from "@/lib/prisma";
import { businessDayBounds } from "@/lib/business-date";
import { renderDayOfJobReminder } from "@/domains/messaging/job-reminder-template";

/**
 * COM-L6A safety cutover: the old cron must never call the legacy direct
 * deliverMessage SMS adapter. That path cannot prove the unique verified
 * contact binding, sender-specific consent, account registration and
 * human-scoped approval now required by COM-L5B and L4B.
 *
 * Review candidates without marking any job "sent". COM-L6B owns the
 * authenticated operator workflow to prepare actual consent-checked intents;
 * no background actor is forged. This is a deliberate safe migration barrier.
 */
export async function sendJobDayOfReminders():
  Promise<{ sent: number; failed: number; heldForReview: number }> {
  const { start, end } = businessDayBounds(new Date());
  const candidates = await prisma.job.findMany({
    where: {
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      scheduledAt: { gte: start, lt: end },
      dayOfReminderSentAt: null,
      customer: { smsOptInAt: { not: null }, phone: { not: null } },
    },
    select: { id: true, type: true },
    take: 100,
  });
  // The template is validated in the same pure renderer used by the owner
  // preview. No provider, customer content or rendered text enters logs.
  let invalid = 0;
  for (const candidate of candidates) {
    try { renderDayOfJobReminder({ type: candidate.type }, 10); }
    catch { invalid += 1; }
  }
  return { sent: 0, failed: invalid, heldForReview: candidates.length - invalid };
}
