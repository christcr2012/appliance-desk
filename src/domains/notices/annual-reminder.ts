import { prisma } from "@/lib/prisma";
import { addBusinessDays, billingPeriodFor, businessDateKey, businessDaysBetween, businessEndOfDay, formatBusinessDate } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing/money";
import { effectiveMonthToMonthTerms } from "@/domains/agreements/month-to-month";
import { createNoticeInTx } from "./index";
import { REMINDER_MAX_DAYS_BEFORE, REMINDER_MIN_DAYS_BEFORE, windowForRenewalStart } from "./state";
import { DEFAULT_ANNUAL_REMINDER_TEXT, fillWording } from "./wording";

/**
 * Yearly reminders for month-to-month rentals (docs/designs/BATCH-B2.md B2-12). Colorado's automatic-renewal law
 * asks, for renewals shorter than twelve months, for a reminder 25 to 40 days before the renewal that would carry the
 * contract past each continuous twelve-month period. The twelve-month periods are counted from the rental's first
 * delivery across every agreement record in the unbroken rental (`continuousSince`), so a replacement agreement
 * never resets the count.
 */

/** The next twelve-month anniversary of the continuous rental that is still ahead of `now`, and its number (1, 2, ...). */
export function nextAnnualBoundary(continuousSince: Date, now: Date): { k: number; boundary: Date } {
  for (let k = 1; k < 100; k += 1) {
    const boundary = billingPeriodFor(continuousSince, 12 * k).start;
    if (boundary.getTime() > now.getTime()) return { k, boundary };
  }
  throw new Error("The continuous rental is older than 99 years.");
}

export const annualReminderKey = (continuityRootId: string, k: number) => `annual-reminder-${continuityRootId}-${k}`;

export type AnnualReminderInput = {
  customerName: string;
  boundary: Date;
  monthlyTotalCents: number;
  lineLabels: string[];
  noticeDays: number;
  businessName: string;
  businessPhone: string;
  businessEmail: string;
  template?: string | null;
};

export function composeAnnualReminder(input: AnnualReminderInput): { subject: string; body: string } {
  const template = input.template?.trim() ? input.template : DEFAULT_ANNUAL_REMINDER_TEXT;
  return {
    subject: `Your month-to-month rental with ${input.businessName} continues: yearly reminder`,
    body: fillWording(template, {
      customerName: input.customerName,
      businessName: input.businessName,
      businessPhone: input.businessPhone,
      businessEmail: input.businessEmail,
      noticeDays: String(input.noticeDays),
      boundaryDate: formatBusinessDate(input.boundary),
      monthlyTotal: formatCents(input.monthlyTotalCents),
      items: input.lineLabels.join(", "),
    }),
  };
}

export type AnnualReminderRun = { queued: number; missed: number; skipped: number };

/**
 * Nightly: for every active month-to-month rental with no ending requested, queue the reminder for its next yearly
 * boundary once that boundary is 40 days away. A boundary already covered by a delivered fixed-term renewal reminder
 * for a renewal starting that same Colorado day gets none. A boundary already under 25 days away is recorded as
 * MISSED at once (never sent) so the owner sees it. A missed reminder never stops billing.
 */
export async function queueAnnualReminders(now: Date = new Date()): Promise<AnnualReminderRun> {
  const run: AnnualReminderRun = { queued: 0, missed: 0, skipped: 0 };
  const candidates = await prisma.rentalAgreement.findMany({
    where: {
      status: "ACTIVE",
      termMonths: null,
      terminationRequestedAt: null,
      continuityRootId: { not: null },
      continuousSince: { not: null },
    },
    select: { id: true, continuityRootId: true, continuousSince: true },
    orderBy: { id: "asc" },
  });
  for (const candidate of candidates) {
    const root = candidate.continuityRootId!;
    const { k, boundary } = nextAnnualBoundary(candidate.continuousSince!, now);
    const daysAway = businessDaysBetween(now, boundary);
    if (daysAway > REMINDER_MAX_DAYS_BEFORE) {
      run.skipped += 1;
      continue;
    }
    await prisma.$transaction(async (tx) => {
      // Re-read under the transaction: the rental may have ended or an ending may have been requested meanwhile.
      const agreement = await tx.rentalAgreement.findUnique({
        where: { id: candidate.id },
        select: {
          id: true,
          status: true,
          termMonths: true,
          terminationRequestedAt: true,
          customerId: true,
          lines: { select: { label: true, monthlyPriceCents: true } },
          customer: { select: { user: { select: { name: true, email: true } } } },
        },
      });
      if (!agreement || agreement.status !== "ACTIVE" || agreement.termMonths !== null || agreement.terminationRequestedAt) {
        run.skipped += 1;
        return;
      }
      // Covered by a delivered fixed-term reminder for a renewal that starts on this same Colorado day?
      const boundaryKey = businessDateKey(boundary);
      const fixedTerms = await tx.rentalAgreement.findMany({
        where: { continuityRootId: root, termMonths: { not: null }, endDate: { not: null } },
        select: { id: true, endDate: true },
      });
      const delivered = await tx.customerNotice.findMany({
        where: { kind: "RENEWAL_REMINDER", status: "SENT", agreementId: { in: fixedTerms.map((f) => f.id) } },
        select: { agreementId: true },
      });
      const deliveredFor = new Set(delivered.map((n) => n.agreementId));
      if (
        fixedTerms.some(
          (f) => deliveredFor.has(f.id) && businessDateKey(addBusinessDays(businessEndOfDay(f.endDate!), 1)) === boundaryKey,
        )
      ) {
        run.skipped += 1;
        return;
      }
      const [terms, settings] = await Promise.all([
        effectiveMonthToMonthTerms(tx, agreement.id, now),
        tx.businessSettings.findUnique({
          where: { id: "singleton" },
          select: { publicBusinessName: true, publicPhone: true, publicEmail: true, annualReminderText: true },
        }),
      ]);
      if (!terms) {
        run.skipped += 1;
        return;
      }
      const composed = composeAnnualReminder({
        customerName: agreement.customer.user.name ?? agreement.customer.user.email,
        boundary,
        monthlyTotalCents: agreement.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0),
        lineLabels: agreement.lines.map((l) => l.label),
        noticeDays: terms.noticeDays,
        businessName: settings?.publicBusinessName ?? "Robinson Appliance Rentals",
        businessPhone: settings?.publicPhone ?? "",
        businessEmail: settings?.publicEmail ?? "",
        template: settings?.annualReminderText,
      });
      const notice = await createNoticeInTx(tx, {
        customerId: agreement.customerId,
        agreementId: agreement.id,
        kind: "ANNUAL_REMINDER",
        dedupeKey: annualReminderKey(root, k),
        subject: composed.subject,
        body: composed.body,
        ...windowForRenewalStart(boundary),
      });
      if (!notice.created) {
        run.skipped += 1;
        return;
      }
      if (daysAway < REMINDER_MIN_DAYS_BEFORE) {
        await tx.customerNotice.update({
          where: { id: notice.id },
          data: { status: "MISSED", lastError: "The yearly reminder's allowed days had already passed when it was first queued." },
        });
        run.missed += 1;
      } else {
        run.queued += 1;
      }
    });
  }
  return run;
}
