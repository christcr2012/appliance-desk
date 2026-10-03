import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import {
  addBusinessDays,
  billingPeriodFor,
  businessDateKey,
  businessEndOfDay,
} from "@/lib/business-date";
import { lockRentalAgreementInTx } from "./index";
import {
  autoRenewPolicyReady,
  loadTerminationPolicy,
  type TerminationPolicy,
  type UnusedTermTreatment,
} from "./term-policy";

export {
  autoRenewPolicyReady,
  loadTerminationPolicy,
  type AutoRenewPolicySettings,
  type TerminationPolicy,
  type TerminationPolicySettings,
  type UnusedTermTreatment,
} from "./term-policy";

/**
 * Fixed-term mechanics: early termination quotes, renewal drafts and
 * auto-renew consent (Batch B, D9/D10). Every policy number comes from the
 * owner's BusinessSettings; a null policy means "feature not available" and is
 * never replaced by a default. No UI and no Stripe calls live here: ending an
 * agreement still goes through the existing close path.
 */

const POLICY_ROLES = ["OWNER", "ADMIN"] as const;
const OPEN_INVOICE_STATUSES = ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] as const;
const MAX_PERIODS = 600;

/** What a quote needs to know about an agreement. Built from the database by `loadTermAgreement`. */
export type TermAgreement = {
  termMonths: number | null;
  endDate: Date | null;
  nextBillingDate: Date | null;
  monthlyTotalCents: number;
  unpaidBalanceCents: number;
  paidInFullInAdvance: boolean;
};

export type EarlyTerminationQuote = {
  requestedOn: Date;
  effectiveOn: Date;
  remainingTermMonths: number;
  remainingRentCents: number;
  feeCents: number;
  unusedTermCents: number;
  unusedTermTreatment: UnusedTermTreatment;
  /** True when the customer prepaid the term: how the prepaid balance (free month, discounts) is settled needs the owner's eyes. */
  prepaidReviewRequired: boolean;
  unpaidBalanceCents: number;
  policyVersion: string;
};

/** Half-up integer percent of a cent amount. */
function percentOf(cents: number, percent: number): number {
  return Math.floor((cents * percent * 2 + 100) / 200);
}

/**
 * Quote an early termination. Pure: same inputs, same answer.
 *
 * Timing: the customer pays in advance on an anniversary, and there is no
 * proration inside a month, so the agreement can only end on a billing
 * anniversary. `effectiveOn` is the first anniversary on or after
 * (requestedOn + noticeDays), counted from the next billing date; if that is
 * beyond the end of the term the agreement simply runs out and nothing remains.
 *
 * Fee (applied exactly as the design states):
 *   fee = min(cap ?? infinity, max(feeCents ?? 0, round(remainingRent * feePercent / 100)))
 * and zero when no whole months remain.
 */
export function quoteEarlyTermination(
  agreement: TermAgreement,
  policy: TerminationPolicy,
  requestedOn: Date,
): EarlyTerminationQuote {
  if (!agreement.termMonths || !agreement.endDate || !agreement.nextBillingDate) {
    throw new Error(
      "Early termination only applies to a fixed-term agreement with a recorded end date and billing date.",
    );
  }
  const termEnd = new Date(businessEndOfDay(agreement.endDate).getTime() + 1000);
  const earliest = addBusinessDays(requestedOn, policy.noticeDays);
  const anchor = agreement.nextBillingDate;

  let first = 0;
  while (
    first < MAX_PERIODS &&
    billingPeriodFor(anchor, first).start < earliest &&
    billingPeriodFor(anchor, first).start < termEnd
  ) {
    first += 1;
  }

  let remainingTermMonths = 0;
  for (let k = first; k < MAX_PERIODS && billingPeriodFor(anchor, k).start < termEnd; k++) {
    remainingTermMonths += 1;
  }

  const effectiveStart = billingPeriodFor(anchor, first).start;
  const effectiveOn = effectiveStart < termEnd ? effectiveStart : termEnd;
  const remainingRentCents = agreement.monthlyTotalCents * remainingTermMonths;

  let feeCents = 0;
  if (remainingTermMonths > 0) {
    const percentFee =
      policy.feePercent === null ? 0 : percentOf(remainingRentCents, policy.feePercent);
    feeCents = Math.max(policy.feeCents ?? 0, percentFee);
    if (policy.feeCapCents !== null) feeCents = Math.min(policy.feeCapCents, feeCents);
  }

  return {
    requestedOn,
    effectiveOn,
    remainingTermMonths,
    remainingRentCents,
    feeCents,
    unusedTermCents: agreement.paidInFullInAdvance ? remainingRentCents : 0,
    unusedTermTreatment: policy.unusedTerm,
    prepaidReviewRequired: agreement.paidInFullInAdvance,
    unpaidBalanceCents: agreement.unpaidBalanceCents,
    policyVersion: policy.version,
  };
}

async function loadTermAgreement(
  tx: Prisma.TransactionClient,
  agreementId: string,
): Promise<TermAgreement> {
  const agreement = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: {
      termMonths: true,
      endDate: true,
      nextBillingDate: true,
      paidInFullInAdvance: true,
      lines: { select: { monthlyPriceCents: true } },
    },
  });
  const openInvoices = await tx.invoice.findMany({
    where: { agreementId, status: { in: [...OPEN_INVOICE_STATUSES] } },
    select: { amountDueCents: true, amountPaidCents: true },
  });
  return {
    termMonths: agreement.termMonths,
    endDate: agreement.endDate,
    nextBillingDate: agreement.nextBillingDate,
    paidInFullInAdvance: agreement.paidInFullInAdvance,
    monthlyTotalCents: agreement.lines.reduce((sum, line) => sum + line.monthlyPriceCents, 0),
    unpaidBalanceCents: openInvoices.reduce(
      (sum, invoice) => sum + Math.max(0, invoice.amountDueCents - invoice.amountPaidCents),
      0,
    ),
  };
}

async function loadSettings(tx: Prisma.TransactionClient) {
  return tx.businessSettings.findUnique({ where: { id: "singleton" } });
}

function sameQuote(a: EarlyTerminationQuote, b: EarlyTerminationQuote): boolean {
  return (
    a.requestedOn.getTime() === b.requestedOn.getTime() &&
    a.effectiveOn.getTime() === b.effectiveOn.getTime() &&
    a.remainingTermMonths === b.remainingTermMonths &&
    a.remainingRentCents === b.remainingRentCents &&
    a.feeCents === b.feeCents &&
    a.unusedTermCents === b.unusedTermCents &&
    a.unusedTermTreatment === b.unusedTermTreatment &&
    a.unpaidBalanceCents === b.unpaidBalanceCents &&
    a.policyVersion === b.policyVersion
  );
}

/** Read-only quote for a real agreement using the owner's saved policy. Returns null when the policy is not set. */
export async function getEarlyTerminationQuote(
  agreementId: string,
  requestedOn: Date = new Date(),
): Promise<EarlyTerminationQuote | null> {
  return prisma.$transaction(async (tx) => {
    const policy = loadTerminationPolicy((await loadSettings(tx)) ?? {});
    if (!policy) return null;
    return quoteEarlyTermination(await loadTermAgreement(tx, agreementId), policy, requestedOn);
  });
}

/**
 * Record an early-termination request. Re-quotes under the agreement lock and
 * rejects if anything in the quote changed since the person saw it. Does NOT
 * end the agreement: ending happens on `terminationEffectiveOn` through the
 * existing close path.
 */
export async function requestEarlyTermination(
  userId: string,
  agreementId: string,
  quote: EarlyTerminationQuote,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, POLICY_ROLES);
    const policy = loadTerminationPolicy((await loadSettings(tx)) ?? {});
    if (!policy) {
      throw new Error(
        "Early termination isn't available yet — the termination policy hasn't been set.",
      );
    }
    const agreement = await lockRentalAgreementInTx(tx, agreementId);
    if (agreement.status !== "ACTIVE") {
      throw new Error("Only an active agreement can be terminated early.");
    }
    if (agreement.terminationRequestedAt) {
      throw new Error("An early termination has already been requested for this agreement.");
    }
    const current = quoteEarlyTermination(
      await loadTermAgreement(tx, agreementId),
      policy,
      quote.requestedOn,
    );
    if (!sameQuote(current, quote)) {
      throw new Error("The numbers changed since this quote was made. Review the new quote and try again.");
    }
    await tx.rentalAgreement.update({
      where: { id: agreementId },
      data: {
        terminationRequestedAt: current.requestedOn,
        terminationEffectiveOn: current.effectiveOn,
        terminationFeeCents: current.feeCents,
        terminationPolicyVersion: current.policyVersion,
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "agreement.termination_requested",
        entityType: "RentalAgreement",
        entityId: agreementId,
        newValue: {
          requestedOn: current.requestedOn.toISOString(),
          effectiveOn: current.effectiveOn.toISOString(),
          remainingTermMonths: current.remainingTermMonths,
          remainingRentCents: current.remainingRentCents,
          feeCents: current.feeCents,
          unusedTermCents: current.unusedTermCents,
          unusedTermTreatment: current.unusedTermTreatment,
          unpaidBalanceCents: current.unpaidBalanceCents,
          policyVersion: current.policyVersion,
        },
      },
    });
  });
}

/**
 * Create a DRAFT renewal that copies the agreement's lines and prices. The
 * current agreement is untouched. A renewal must start the business day after
 * the current term ends (no overlap, no gap), a deposit is never charged
 * again (the existing one carries over), and appliance assignments are not
 * copied: the appliances stay with the current agreement until it ends. The
 * new draft's term dates are set by the normal signing/billing path.
 */
export async function renewAgreement(
  userId: string,
  agreementId: string,
  input: { termMonths: number | null; startOn: Date },
): Promise<{ newAgreementId: string }> {
  if (input.termMonths !== null && (!Number.isInteger(input.termMonths) || input.termMonths < 1)) {
    throw new Error("A renewal term must be a whole number of months, or month-to-month.");
  }
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, POLICY_ROLES);
    const old = await lockRentalAgreementInTx(tx, agreementId);
    if (old.status !== "ACTIVE") {
      throw new Error("Only an active agreement can be renewed.");
    }
    if (!old.termMonths || !old.endDate) {
      throw new Error("Only a fixed-term agreement with a recorded end date can be renewed.");
    }
    const firstDayAfterTerm = businessDateKey(new Date(businessEndOfDay(old.endDate).getTime() + 1000));
    if (businessDateKey(input.startOn) !== firstDayAfterTerm) {
      throw new Error(
        `A renewal has to start the day after the current term ends (${firstDayAfterTerm}), so the two terms never overlap.`,
      );
    }
    const existing = await tx.rentalAgreement.findFirst({
      where: { renewedFromAgreementId: old.id, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (existing) {
      throw new Error("This agreement already has a renewal.");
    }

    const settings = await loadSettings(tx);
    const holdDays = settings?.draftReservationHoldDays ?? 7;
    const lines = await tx.rentalLine.findMany({ where: { agreementId: old.id } });
    const created = await tx.rentalAgreement.create({
      data: {
        customerId: old.customerId,
        serviceAddressId: old.serviceAddressId,
        termMonths: input.termMonths,
        depositCents: 0,
        damageWaiverCents: old.damageWaiverCents,
        lateFeeGraceDays: old.lateFeeGraceDays,
        lateFeeCents: old.lateFeeCents,
        lateFeePercent: old.lateFeePercent,
        taxRatePermille: old.taxRatePermille,
        paidInFullInAdvance: false,
        freeMonthGranted: false,
        renewedFromAgreementId: old.id,
        reservationExpiresAt: addBusinessDays(new Date(), holdDays),
        lines: {
          create: lines.map((line) => ({
            label: line.label,
            monthlyPriceCents: line.monthlyPriceCents,
            listPriceCents: line.listPriceCents,
            prepayDiscountCentsPerMonth: line.prepayDiscountCentsPerMonth,
          })),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "agreement.renewal_drafted",
        entityType: "RentalAgreement",
        entityId: created.id,
        newValue: {
          renewedFromAgreementId: old.id,
          termMonths: input.termMonths,
          startsOn: firstDayAfterTerm,
          lineCount: lines.length,
        },
      },
    });
    return { newAgreementId: created.id };
  });
}

/**
 * Record or withdraw the customer's auto-renew consent. Consent is only
 * accepted for the terms version the owner currently publishes, and every
 * change leaves a ConsentRecord. Turning it off never ends the agreement.
 */
export async function setAutoRenew(
  userId: string,
  agreementId: string,
  input: { enabled: boolean; termsVersion: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, POLICY_ROLES);
    const settings = await loadSettings(tx);
    const agreement = await lockRentalAgreementInTx(tx, agreementId);
    if (agreement.status !== "ACTIVE") {
      throw new Error("Auto-renew can only be changed on an active agreement.");
    }
    if (input.enabled) {
      if (!settings || !autoRenewPolicyReady(settings)) {
        throw new Error("Auto-renew isn't available yet — the renewal terms haven't been set.");
      }
      if (input.termsVersion !== settings.autoRenewTermsVersion) {
        throw new Error("Those renewal terms are out of date. Show the customer the current terms and try again.");
      }
    }
    const now = new Date();
    await tx.rentalAgreement.update({
      where: { id: agreementId },
      data: input.enabled
        ? {
            renewalPreference: "AUTO_RENEW",
            autoRenewConsentedAt: now,
            autoRenewTermsVersion: input.termsVersion,
          }
        : { renewalPreference: "NONE", autoRenewConsentedAt: null, autoRenewTermsVersion: null },
    });
    await tx.consentRecord.create({
      data: {
        customerId: agreement.customerId,
        kind: "auto_renew",
        details: {
          agreementId,
          enabled: input.enabled,
          termsVersion: input.termsVersion,
          recordedByUserId: userId,
        },
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: input.enabled ? "agreement.auto_renew_enabled" : "agreement.auto_renew_disabled",
        entityType: "RentalAgreement",
        entityId: agreementId,
        newValue: { termsVersion: input.termsVersion },
      },
    });
  });
}
