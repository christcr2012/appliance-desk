import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { automationCounts } from "@/domains/automation/counts";
import { startDueRenewals } from "@/domains/agreements/renewal-start";
import { runAutoRenewals, extendBillingForDeliveredAutoRenewals } from "@/domains/agreements/auto-renew";
import { sendPendingNotices } from "@/domains/notices";
import { queueAnnualReminders } from "@/domains/notices/annual-reminder";
import { runDueTerminations } from "@/domains/agreements/termination-execution";
import { closeFullyReturnedAgreements } from "@/domains/agreements/returns";

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

  // Keep the post-D production order: later passes depend on evidence or state
  // created by earlier ones. Each pass has its own durable rule identity so a
  // crash cannot make the route falsely report the whole lifecycle as healthy.
  const autoRenewals = await runAutomation({
    ruleKey: "start-renewals:auto-renewals",
    work: async () => {
      const result = await runAutoRenewals();
      if (result.problems.length > 0) {
        console.error("[cron] Automatic renewals that could not be queued:", result.problems);
      }
      return { counts: automationCounts(result) };
    },
  });

  const annualReminders = await runAutomation({
    ruleKey: "start-renewals:annual-reminders",
    work: async () => {
      const result = await queueAnnualReminders();
      if (result.missed > 0) console.error("[cron] Yearly reminders already past their allowed days:", result.missed);
      return { counts: automationCounts(result) };
    },
  });

  const pendingNotices = await runAutomation({
    ruleKey: "start-renewals:pending-notices",
    work: async () => ({ counts: automationCounts(await sendPendingNotices()) }),
  });

  const billingExtensions = await runAutomation({
    ruleKey: "start-renewals:billing-extensions",
    work: async () => ({ counts: automationCounts(await extendBillingForDeliveredAutoRenewals()) }),
  });

  const dueTerminations = await runAutomation({
    ruleKey: "start-renewals:due-terminations",
    work: async () => {
      const result = await runDueTerminations();
      if (result.needsReview.length > 0) {
        console.error("[cron] Early endings that need attention:", result.needsReview);
      }
      return { counts: automationCounts(result) };
    },
  });

  const closeReturns = await runAutomation({
    ruleKey: "start-renewals:close-returns",
    work: async () => ({ counts: automationCounts(await closeFullyReturnedAgreements()) }),
  });

  const startRenewals = await runAutomation({
    ruleKey: "start-renewals:start-due-renewals",
    work: async () => {
      const result = await startDueRenewals();
      if (result.blocked.length > 0) {
        console.error("[cron] Renewals that could not start:", result.blocked);
      }
      return { counts: automationCounts(result) };
    },
  });

  return NextResponse.json({
    autoRenewals,
    annualReminders,
    pendingNotices,
    billingExtensions,
    dueTerminations,
    closeReturns,
    startRenewals,
  });
}
