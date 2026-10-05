import { prisma } from "@/lib/prisma";
import { deliverMessage } from "@/domains/messaging/deliver";
import { formatCents } from "@/domains/pricing";

const REMINDER_WINDOW_DAYS = 2;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Claim the cycle before provider work. FAILED/NOT_SENT gives the claim back;
 * UNKNOWN keeps it because the message may already have been accepted. */
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
      customer: {
        select: {
          id: true,
          user: { select: { name: true, email: true } },
        },
      },
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
    if (
      agreement.billingReminderSentForDate?.getTime() ===
      agreement.nextBillingDate.getTime()
    ) {
      continue;
    }

    const previousMark = agreement.billingReminderSentForDate;
    const claimed = await prisma.rentalAgreement.updateMany({
      where: {
        id: agreement.id,
        nextBillingDate: agreement.nextBillingDate,
        OR: [
          { billingReminderSentForDate: null },
          { billingReminderSentForDate: { not: agreement.nextBillingDate } },
        ],
      },
      data: { billingReminderSentForDate: agreement.nextBillingDate },
    });
    if (claimed.count === 0) continue;

    const release = () =>
      prisma.rentalAgreement.updateMany({
        where: {
          id: agreement.id,
          billingReminderSentForDate: agreement.nextBillingDate,
        },
        data: { billingReminderSentForDate: previousMark },
      });

    const approxAmountCents = agreement.invoices[0]?.amountDueCents ?? null;
    const dateLabel = agreement.nextBillingDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    try {
      const delivery = await deliverMessage({
        idempotencyKey: `billing-reminder-${agreement.id}-${agreement.nextBillingDate.getTime()}`,
        channel: "EMAIL",
        purpose: "TRANSACTIONAL",
        templateKey: "billing-reminder",
        customerFacing: true,
        recipient: {
          type: "Customer",
          id: agreement.customer.id,
          address: agreement.customer.user.email,
        },
        subject: { type: "RentalAgreement", id: agreement.id },
        render: () => ({
          subject: "Your upcoming payment",
          text: `Hi${agreement.customer.user.name ? ` ${agreement.customer.user.name}` : ""},\n\nJust a heads-up: your next rental payment is scheduled for ${dateLabel}${approxAmountCents !== null ? ` for approximately ${formatCents(approxAmountCents)}` : ""}. No action is needed — this will be charged automatically to the payment method on file.\n\nIf anything about your rental has changed, or you have questions, just reply to this email.`,
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
      console.error("[billing] Failed to record billing reminder", agreement.id, error);
      failed += 1;
    }
  }

  return { sent, failed };
}
