import { prisma } from "@/lib/prisma";
import { addBusinessDays } from "@/lib/business-date";
import { syncSubscriptionTerm } from "@/domains/billing/subscription-term";
import { cancelAgreement, lockRentalAgreementInTx } from "./index";
import { renewalCreateData } from "./renewal-data";
import { snapshotAutoRenew } from "./terms-snapshot";

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

/** Is the reminder window open for this agreement, and has the term not already run out? */
export function autoRenewWindowOpen(
  agreement: { endDate: Date; noticeDays: number },
  now: Date,
): boolean {
  if (now.getTime() > agreement.endDate.getTime()) return false;
  return addBusinessDays(agreement.endDate, -agreement.noticeDays).getTime() <= now.getTime();
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
  for (const renewal of waiting) {
    const old = await prisma.rentalAgreement.findUnique({
      where: { id: renewal.renewedFromAgreementId! },
      select: { status: true, renewalPreference: true, terminationRequestedAt: true },
    });
    if (!old) continue;
    const stillWanted =
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
