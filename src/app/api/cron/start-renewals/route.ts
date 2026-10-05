import { NextResponse } from "next/server";
import { startDueRenewals } from "@/domains/agreements/renewal-start";
import { runAutoRenewals, extendBillingForDeliveredAutoRenewals } from "@/domains/agreements/auto-renew";
import { sendPendingNotices } from "@/domains/notices";
import { queueAnnualReminders } from "@/domains/notices/annual-reminder";
import { runDueTerminations } from "@/domains/agreements/termination-execution";

// Fired once a day by Vercel Cron (see vercel.json). The nightly rental
// lifecycle pass, in this order: (1) queue the month-to-month renewal for each
// customer who agreed to auto-renew and cancel ones they withdrew, (2) end every
// rental whose agreed early-ending date has arrived (fee invoiced, nothing charged
// automatically), (3) start every signed renewal whose start date has arrived: the renewal becomes the active rental
// and the rental it renews ends, in one step (src/domains/agreements/
// renewal-start.ts). Safe to run twice: a renewal that already started is no
// longer SCHEDULED. Same CRON_SECRET bearer-token check as the other cron jobs.
export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to start renewals.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const autoRenewals = await runAutoRenewals();
  if (autoRenewals.problems.length > 0) {
    console.error("[cron] Automatic renewals that could not be queued:", autoRenewals.problems);
  }
  // Yearly reminders for month-to-month rentals, queued 40 days ahead (they are emailed just below).
  const annual = await queueAnnualReminders();
  if (annual.missed > 0) console.error("[cron] Yearly reminders already past their allowed days:", annual.missed);
  // Reminders created above are emailed now. While live customer email is off they stay "waiting".
  const notices = await sendPendingNotices();
  // A reminder that was just delivered releases the held billing-date extension.
  const billingExtended = await extendBillingForDeliveredAutoRenewals();
  const terminations = await runDueTerminations();
  if (terminations.needsReview.length > 0) {
    console.error("[cron] Early endings that need attention:", terminations.needsReview);
  }
  const result = await startDueRenewals();
  if (result.blocked.length > 0) {
    console.error("[cron] Renewals that could not start:", result.blocked);
  }
  return NextResponse.json({
    started: result.started,
    blocked: result.blocked.length,
    autoRenewalsQueued: autoRenewals.created,
    autoRenewalsCancelled: autoRenewals.cancelled,
    annualRemindersQueued: annual.queued,
    annualRemindersMissed: annual.missed,
    noticesSent: notices.sent,
    noticesWaiting: notices.stillWaiting,
    billingExtended,
    endedEarly: terminations.ended,
    earlyEndingFeeInvoices: terminations.feeInvoices,
    earlyEndingsNeedingAttention: terminations.needsReview.length,
  });
}
