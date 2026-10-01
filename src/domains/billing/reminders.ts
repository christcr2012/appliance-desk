import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formatCents } from "@/domains/pricing";

// ---------------------------------------------------------------------------
// Billing reminders (Task #67, docs/DECISIONS.md 2026-09-28, "Automation
// rules" — Chris's pick: "remind customers a day or two before their
// recurring payment runs"). Driven off RentalAgreement.nextBillingDate,
// which the Stripe webhook already keeps current (see
// src/domains/billing/webhooks.ts) — no separate Stripe API call needed
// here.
//
// Runs from a daily Vercel Cron job (src/app/api/cron/billing-reminders,
// vercel.json). billingReminderSentForDate (see that field's own schema
// comment) is what stops the same cycle's reminder from going out twice
// during the 2-day window.
// ---------------------------------------------------------------------------

const REMINDER_WINDOW_DAYS = 2;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Sends "your payment is coming up" emails for every active agreement
 * whose next charge is within REMINDER_WINDOW_DAYS and hasn't already
 * been reminded for this specific billing date. Best-effort per
 * agreement — one failed email never stops the rest from going out;
 * returns a summary for the cron route to log. */
export async function sendUpcomingBillingReminders(): Promise<{
  sent: number;
  failed: number;
}> {
  const now = new Date();

  const dueAgreements = await prisma.rentalAgreement.findMany({
    where: {
      status: "ACTIVE",
      stripeSubscriptionId: { not: null },
      nextBillingDate: { gte: now, lte: addDays(now, REMINDER_WINDOW_DAYS) },
    },
    select: {
      id: true,
      nextBillingDate: true,
      billingReminderSentForDate: true,
      customer: { include: { user: { select: { name: true, email: true } } } },
      invoices: {
        orderBy: [{ createdAt: "desc" }],
        take: 1,
        select: { amountDueCents: true },
      },
    },
  });

  let sent = 0;
  let failed = 0;

  for (const agreement of dueAgreements) {
    if (!agreement.nextBillingDate) continue;
    const alreadySentForThisCycle =
      agreement.billingReminderSentForDate?.getTime() ===
      agreement.nextBillingDate.getTime();
    if (alreadySentForThisCycle) continue;

    // The exact amount can drift slightly (a price change, a late fee
    // added since) — this is a heads-up, not a bill, so the most recent
    // invoice's amount is a close-enough approximation, same spirit as
    // this app's other documented approximations. Omitted entirely if
    // there's no prior invoice to go by, rather than guessing.
    const approxAmountCents = agreement.invoices[0]?.amountDueCents ?? null;
    const dateLabel = agreement.nextBillingDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    try {
      const delivery = await sendEmail({
        to: agreement.customer.user.email,
        subject: "Your upcoming payment",
        text: `Hi${agreement.customer.user.name ? ` ${agreement.customer.user.name}` : ""},\n\nJust a heads-up: your next rental payment is scheduled for ${dateLabel}${approxAmountCents !== null ? ` for approximately ${formatCents(approxAmountCents)}` : ""}. No action is needed — this will be charged automatically to the payment method on file.\n\nIf anything about your rental has changed, or you have questions, just reply to this email.`,
      });
      if (!delivery.sent) {
        failed += 1;
        continue;
      }
      await prisma.rentalAgreement.update({
        where: { id: agreement.id },
        data: { billingReminderSentForDate: agreement.nextBillingDate },
      });
      sent += 1;
    } catch (error) {
      console.error("[billing] Failed to send billing reminder", agreement.id, error);
      failed += 1;
    }
  }

  return { sent, failed };
}
