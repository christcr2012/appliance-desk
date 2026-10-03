import { prisma } from "@/lib/prisma";
import { isAutoRenewEnabled } from "@/domains/settings/auto-renew-switch";
import { businessDaysBetween } from "@/lib/business-date";
import { syncSubscriptionTerm } from "@/domains/billing/subscription-term";
import { cancelAgreement, lockRentalAgreementInTx } from "./index";
import { renewalCreateData } from "./renewal-data";
import { snapshotAutoRenew } from "./terms-snapshot";
import { createNoticeInTx } from "@/domains/notices";
import { composeRenewalReminder, renewalReminderKey } from "@/domains/notices/renewal-reminder";

/**
 * Acting on a customer's auto-renew agreement.
 *
 * A customer who agreed to auto-renew (and still has it switched on) is renewed
 * month-to-month, the continuation the wording they agreed to describes: the
 * same rental, the same prices, no new fixed term. The renewal is created in the
 * "signed, starts later" (SCHEDULED) state at the moment the customer's reminder
 * window opens (the number of days before the term ends that THIS agreement was
 * signed with), so the renewal is already waiting if nobody does anything, and it
 * can be cancelled right up to its start date by turning auto-renew off.
 *
 * Nothing here charges a card or sends an email: the monthly billing simply
 * carries on (its end date is moved by the same one-step process as any signed
 * renewal), and notices are a separate piece (docs/OWNER-INPUTS.md IN-21).
 */

export type AutoRenewRunResult = {
  created: number;
  cancelled: number;
  problems: Array<{ agreementId: string; message: string }>;
};

/**
 * Is the reminder window open for this agreement, and has the term not already run out? Counted
 * in Colorado calendar days from today to the day the renewal starts (the day after the term's
 * last day), the same way the reminder's delivery date is checked.
 */
export function autoRenewWindowOpen(
  agreement: { endDate: Date; noticeDays: number },
  now: Date,
): boolean {
  if (now.getTime() > agreement.endDate.getTime()) return false;
  const renewalStart = new Date(agreement.endDate.getTime() + 1000);
  return businessDaysBetween(now, renewalStart) <= agreement.noticeDays;
}

type CreateOutcome = { created: true; renewalId: string } | { created: false };

async function createAutoRenewal(agreementId: string, now: Date): Promise<CreateOutcome> {
  const outcome = await prisma.$transaction(async (tx) => {
    const old = await lockRentalAgreementInTx(tx, agreementId);
    // Everything is re-checked under the lock: the customer may have just turned it off or asked to end early.
    if (
      old.status !== "ACTIVE" ||
      old.renewalPreference !== "AUTO_RENEW" ||
      !old.autoRenewConsentedAt ||
      old.terminationRequestedAt ||
      // A rental paid in advance has no monthly billing to carry on: the owner decides how it continues.
      old.paidInFullInAdvance ||
      !old.termMonths ||
      !old.endDate
    ) {
      return { created: false } as const;
    }
    const locked = snapshotAutoRenew(old.termsSnapshot);
    if (!locked || locked.termsVersion !== old.autoRenewTermsVersion) return { created: false } as const;
    if (!autoRenewWindowOpen({ endDate: old.endDate, noticeDays: locked.noticeDays }, now)) {
      return { created: false } as const;
    }
    const existing = await tx.rentalAgreement.findFirst({
      where: { renewedFromAgreementId: old.id, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (existing) return { created: false } as const;

    const lines = await tx.rentalLine.findMany({ where: { agreementId: old.id } });
    if (lines.length === 0) return { created: false } as const;
    const created = await tx.rentalAgreement.create({
      data: renewalCreateData(old, lines, {
        termMonths: null,
        status: "SCHEDULED",
        createdByAutoRenew: true,
      }),
    });
    // The reminder is created with the renewal, in the same transaction: no renewal without its reminder.
    const [settings, customer] = await Promise.all([
      tx.businessSettings.findUnique({
        where: { id: "singleton" },
        select: { publicBusinessName: true, publicPhone: true, publicEmail: true },
      }),
      tx.customer.findUniqueOrThrow({
        where: { id: old.customerId },
        select: { user: { select: { name: true, email: true } } },
      }),
    ]);
    const reminder = composeRenewalReminder({
      customerName: customer.user.name ?? customer.user.email,
      termMonths: old.termMonths,
      termEndDate: old.endDate,
      renewalStartDate: created.startDate ?? old.endDate,
      monthlyTotalCents: lines.reduce((sum, line) => sum + line.monthlyPriceCents, 0),
      lineLabels: lines.map((line) => line.label),
      renewalTermsText: locked.termsText,
      businessName: settings?.publicBusinessName ?? "Robinson Appliance Rentals",
      businessPhone: settings?.publicPhone ?? "",
      businessEmail: settings?.publicEmail ?? "",
    });
    await createNoticeInTx(tx, {
      customerId: old.customerId,
      agreementId: old.id,
      kind: "RENEWAL_REMINDER",
      dedupeKey: renewalReminderKey(old.id, old.endDate),
      subject: reminder.subject,
      body: reminder.body,
    });
    await tx.auditLog.create({
      data: {
        userId: null,
        action: "agreement.auto_renewal_scheduled",
        entityType: "RentalAgreement",
        entityId: created.id,
        newValue: {
          renewedFromAgreementId: old.id,
          termsVersion: old.autoRenewTermsVersion,
          consentedAt: old.autoRenewConsentedAt.toISOString(),
          continuesAs: "month-to-month",
          lineCount: lines.length,
        },
      },
    });
    return { created: true, renewalId: created.id } as const;
  });
  if (outcome.created) {
    try {
      // Moves the subscription's end date now; the nightly start retries it if Stripe is down.
      await syncSubscriptionTerm(outcome.renewalId, "extend");
    } catch (error) {
      console.error(`Auto-renewal ${outcome.renewalId} created but its billing end date could not be moved yet:`, error);
    }
  }
  return outcome;
}

/**
 * Cancel waiting auto-renewals whose agreement no longer wants them (the customer
 * turned auto-renew off, or asked to end early). A renewal someone signed by hand
 * is never touched. Pass `agreementId` to look at one agreement only.
 */
export async function cancelWithdrawnAutoRenewals(
  actorUserId: string | null,
  agreementId?: string,
): Promise<number> {
  const waiting = await prisma.rentalAgreement.findMany({
    where: {
      status: "SCHEDULED",
      createdByAutoRenew: true,
      renewedFromAgreementId: agreementId ?? { not: null },
    },
    select: {
      id: true,
      renewedFromAgreementId: true,
    },
  });
  let cancelled = 0;
  // With the owner's master switch OFF every queued automatic renewal is withdrawn, even though the customer
  // is still opted in: cancelling restores the billing stop date and withdraws the waiting reminder.
  const switchOn = await isAutoRenewEnabled();
  for (const renewal of waiting) {
    const old = await prisma.rentalAgreement.findUnique({
      where: { id: renewal.renewedFromAgreementId! },
      select: { status: true, renewalPreference: true, terminationRequestedAt: true },
    });
    if (!old) continue;
    const stillWanted =
      switchOn &&
      old.status === "ACTIVE" && old.renewalPreference === "AUTO_RENEW" && !old.terminationRequestedAt;
    if (stillWanted) continue;
    try {
      await cancelAgreement(actorUserId, renewal.id);
      cancelled += 1;
    } catch (error) {
      // Already moved on (for example it just started or was cancelled by hand); the nightly pass looks again.
      console.error(`Could not cancel withdrawn auto-renewal ${renewal.id}:`, error);
    }
  }
  return cancelled;
}

/** Nightly job: create the renewals that are due, and cancel the ones that were withdrawn. One failure never blocks the others. */
export async function runAutoRenewals(now = new Date()): Promise<AutoRenewRunResult> {
  const result: AutoRenewRunResult = { created: 0, cancelled: 0, problems: [] };
  result.cancelled = await cancelWithdrawnAutoRenewals(null);
  // Cancelling withdrawn renewals above always runs. Queuing new ones needs the owner's master switch.
  if (!(await isAutoRenewEnabled())) return result;

  const candidates = await prisma.rentalAgreement.findMany({
    where: {
      status: "ACTIVE",
      renewalPreference: "AUTO_RENEW",
      terminationRequestedAt: null,
      paidInFullInAdvance: false,
      termMonths: { not: null },
      endDate: { not: null },
    },
    select: { id: true },
    orderBy: { endDate: "asc" },
  });
  for (const { id } of candidates) {
    try {
      const outcome = await createAutoRenewal(id, now);
      if (outcome.created) result.created += 1;
    } catch (error) {
      result.problems.push({ agreementId: id, message: error instanceof Error ? error.message : "Unknown error" });
    }
  }
  return result;
}

/**
 * Keep the subscription's end date until the reminder is delivered on time, THEN extend it
 * (before the term ends): billing must never run past the old term for a renewal that cannot
 * start. Safe to run any number of times; also called right after an owner marks a reminder delivered.
 */
export async function extendBillingForDeliveredAutoRenewals(now = new Date()): Promise<number> {
  if (!(await isAutoRenewEnabled())) return 0;
  const waiting = await prisma.rentalAgreement.findMany({
    where: { status: "SCHEDULED", createdByAutoRenew: true, startDate: { gt: now } },
    select: { id: true },
  });
  let extended = 0;
  for (const { id } of waiting) {
    try {
      if ((await syncSubscriptionTerm(id, "extend")) === "done") extended += 1;
    } catch (error) {
      console.error(`Could not move the billing end date for automatic renewal ${id} yet:`, error);
    }
  }
  return extended;
}
