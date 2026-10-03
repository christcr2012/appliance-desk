import { createHash } from "node:crypto";
import type { Prisma, RentalAgreementStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { addBusinessDays, billingPeriodFor } from "@/lib/business-date";

export type UnusedTermTreatment = "REFUND" | "CREDIT" | "RETAIN";

export type TerminationPolicy = {
  feeCents: number | null;
  feePercent: number | null;
  feeCapCents: number | null;
  noticeDays: number;
  unusedTerm: UnusedTermTreatment;
  version: string;
};

type PolicySettings = {
  earlyTerminationFeeCents?: number | null;
  earlyTerminationFeePercent?: number | null;
  earlyTerminationFeeCapCents?: number | null;
  earlyTerminationNoticeDays?: number | null;
  unusedTermTreatment?: string | null;
  terminationTermsText?: string | null;
};

function validNullableNonNegative(value: number | null | undefined): boolean {
  return value == null || (Number.isInteger(value) && value >= 0);
}

function isUnusedTermTreatment(value: unknown): value is UnusedTermTreatment {
  return value === "REFUND" || value === "CREDIT" || value === "RETAIN";
}

/** Null means the owner has not configured a complete termination policy yet. */
export function loadTerminationPolicy(
  settings: PolicySettings,
): TerminationPolicy | null {
  if (
    settings.earlyTerminationNoticeDays == null ||
    !Number.isInteger(settings.earlyTerminationNoticeDays) ||
    settings.earlyTerminationNoticeDays < 0 ||
    !isUnusedTermTreatment(settings.unusedTermTreatment) ||
    !settings.terminationTermsText?.trim() ||
    !validNullableNonNegative(settings.earlyTerminationFeeCents) ||
    !validNullableNonNegative(settings.earlyTerminationFeePercent) ||
    !validNullableNonNegative(settings.earlyTerminationFeeCapCents)
  ) {
    return null;
  }

  const fingerprint = JSON.stringify({
    feeCents: settings.earlyTerminationFeeCents ?? null,
    feePercent: settings.earlyTerminationFeePercent ?? null,
    feeCapCents: settings.earlyTerminationFeeCapCents ?? null,
    noticeDays: settings.earlyTerminationNoticeDays,
    unusedTerm: settings.unusedTermTreatment,
    terms: settings.terminationTermsText.trim(),
  });

  return {
    feeCents: settings.earlyTerminationFeeCents ?? null,
    feePercent: settings.earlyTerminationFeePercent ?? null,
    feeCapCents: settings.earlyTerminationFeeCapCents ?? null,
    noticeDays: settings.earlyTerminationNoticeDays,
    unusedTerm: settings.unusedTermTreatment,
    version: `termination-${createHash("sha256").update(fingerprint).digest("hex").slice(0, 16)}`,
  };
}

type TerminationAgreement = {
  termMonths: number | null;
  startDate: Date | null;
  endDate: Date | null;
  nextBillingDate: Date | null;
  paidInFullInAdvance: boolean;
  lines: Array<{ monthlyPriceCents: number }>;
  invoices?: Array<{
    status: string;
    amountDueCents: number;
    amountPaidCents: number;
  }>;
};

export type EarlyTerminationQuote = {
  requestedOn: Date;
  effectiveOn: Date;
  remainingTermMonths: number;
  remainingRentCents: number;
  feeCents: number;
  unusedTermCents: number;
  unusedTermTreatment: UnusedTermTreatment;
  unpaidBalanceCents: number;
  policyVersion: string;
};

function countWholeBillingMonths(effectiveOn: Date, endDate: Date): number {
  let months = 0;
  while (months < 120 && billingPeriodFor(effectiveOn, months).start < endDate) {
    months += 1;
  }
  return months;
}

/**
 * Quote a fixed-term early termination without prorating inside a billing
 * month. Notice days are calendar days and effectiveOn never precedes the next
 * anniversary billing date.
 */
export function quoteEarlyTermination(
  agreement: TerminationAgreement,
  policy: TerminationPolicy,
  requestedOn: Date,
): EarlyTerminationQuote {
  if (!Number.isFinite(requestedOn.getTime())) throw new Error("Invalid requested date.");
  if (!agreement.termMonths || !agreement.startDate || !agreement.endDate) {
    throw new Error("Early termination only applies to a fixed-term agreement.");
  }

  const noticeDate = addBusinessDays(requestedOn, policy.noticeDays);
  const effectiveOn =
    agreement.nextBillingDate && agreement.nextBillingDate > noticeDate
      ? agreement.nextBillingDate
      : noticeDate;
  if (effectiveOn >= agreement.endDate) {
    return {
      requestedOn,
      effectiveOn: agreement.endDate,
      remainingTermMonths: 0,
      remainingRentCents: 0,
      feeCents: 0,
      unusedTermCents: 0,
      unusedTermTreatment: policy.unusedTerm,
      unpaidBalanceCents: (agreement.invoices ?? []).reduce((sum, invoice) => {
        if (["PAID", "VOID", "REFUNDED", "WRITTEN_OFF"].includes(invoice.status)) return sum;
        return sum + Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
      }, 0),
      policyVersion: policy.version,
    };
  }

  const remainingTermMonths = countWholeBillingMonths(effectiveOn, agreement.endDate);
  const monthlyRentCents = agreement.lines.reduce(
    (sum, line) => sum + line.monthlyPriceCents,
    0,
  );
  const remainingRentCents = monthlyRentCents * remainingTermMonths;
  const percentFee = Math.round(
    (remainingRentCents * (policy.feePercent ?? 0)) / 100,
  );
  const uncappedFee = Math.max(policy.feeCents ?? 0, percentFee);
  const feeCents = Math.min(policy.feeCapCents ?? Number.POSITIVE_INFINITY, uncappedFee);
  const unpaidBalanceCents = (agreement.invoices ?? []).reduce((sum, invoice) => {
    if (["PAID", "VOID", "REFUNDED", "WRITTEN_OFF"].includes(invoice.status)) return sum;
    return sum + Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
  }, 0);

  return {
    requestedOn,
    effectiveOn,
    remainingTermMonths,
    remainingRentCents,
    feeCents,
    unusedTermCents: agreement.paidInFullInAdvance ? remainingRentCents : 0,
    unusedTermTreatment: policy.unusedTerm,
    unpaidBalanceCents,
    policyVersion: policy.version,
  };
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

async function lockAgreement(tx: Prisma.TransactionClient, agreementId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "RentalAgreement" WHERE "id" = ${agreementId} FOR UPDATE
  `;
  if (rows.length !== 1) throw new Error("Couldn't find that rental agreement.");
}

export async function requestEarlyTermination(
  userId: string,
  agreementId: string,
  quote: EarlyTerminationQuote,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await lockAgreement(tx, agreementId);

    const [agreement, settings] = await Promise.all([
      tx.rentalAgreement.findUniqueOrThrow({
        where: { id: agreementId },
        include: {
          lines: { select: { monthlyPriceCents: true } },
          invoices: {
            select: { status: true, amountDueCents: true, amountPaidCents: true },
          },
        },
      }),
      tx.businessSettings.findUnique({ where: { id: "singleton" } }),
    ]);
    if (agreement.status !== "ACTIVE") {
      throw new Error("Only an active fixed-term agreement can be terminated early.");
    }
    if (agreement.terminationRequestedAt) {
      throw new Error("An early termination request is already recorded for this agreement.");
    }

    const policy = settings ? loadTerminationPolicy(settings) : null;
    if (!policy) {
      throw new Error("Early termination is not available until the owner configures the policy.");
    }
    const currentQuote = quoteEarlyTermination(agreement, policy, quote.requestedOn);
    if (!sameQuote(currentQuote, quote)) {
      throw new Error("The termination quote changed. Refresh it before confirming.");
    }

    await tx.rentalAgreement.update({
      where: { id: agreementId },
      data: {
        terminationRequestedAt: quote.requestedOn,
        terminationEffectiveOn: quote.effectiveOn,
        terminationFeeCents: quote.feeCents,
        terminationPolicyVersion: quote.policyVersion,
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "agreement.early_termination_requested",
        entityType: "RentalAgreement",
        entityId: agreementId,
        newValue: {
          effectiveOn: quote.effectiveOn.toISOString(),
          feeCents: quote.feeCents,
          unusedTermCents: quote.unusedTermCents,
          unusedTermTreatment: quote.unusedTermTreatment,
          unpaidBalanceCents: quote.unpaidBalanceCents,
          policyVersion: quote.policyVersion,
        },
      },
    });
  });
}

export async function renewAgreement(
  userId: string,
  agreementId: string,
  input: { termMonths: number | null; startOn: Date },
): Promise<{ newAgreementId: string }> {
  if (!Number.isFinite(input.startOn.getTime())) throw new Error("Invalid renewal start date.");
  if (input.termMonths !== null && (!Number.isInteger(input.termMonths) || input.termMonths <= 0)) {
    throw new Error("Renewal term must be a positive whole number of months or month-to-month.");
  }

  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await lockAgreement(tx, agreementId);
    const agreement = await tx.rentalAgreement.findUniqueOrThrow({
      where: { id: agreementId },
      include: { lines: true },
    });
    if (!(agreement.status === "ACTIVE" || agreement.status === "ENDED")) {
      throw new Error("Only an active or ended agreement can be renewed.");
    }
    const existing = await tx.rentalAgreement.findFirst({
      where: { renewedFromAgreementId: agreementId, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (existing) {
      throw new Error("A renewal draft already exists for this agreement.");
    }

    const endDate = input.termMonths
      ? billingPeriodFor(input.startOn, input.termMonths).start
      : null;
    const renewal = await tx.rentalAgreement.create({
      data: {
        customerId: agreement.customerId,
        serviceAddressId: agreement.serviceAddressId,
        status: "DRAFT",
        termMonths: input.termMonths,
        startDate: input.startOn,
        endDate,
        depositCents: agreement.depositCents,
        damageWaiverCents: agreement.damageWaiverCents,
        lateFeeGraceDays: agreement.lateFeeGraceDays,
        lateFeeCents: agreement.lateFeeCents,
        lateFeePercent: agreement.lateFeePercent,
        taxRatePermille: agreement.taxRatePermille,
        paidInFullInAdvance: false,
        freeMonthGranted: false,
        renewedFromAgreementId: agreement.id,
      },
      select: { id: true },
    });
    if (agreement.lines.length > 0) {
      await tx.rentalLine.createMany({
        data: agreement.lines.map((line) => ({
          agreementId: renewal.id,
          label: line.label,
          monthlyPriceCents: line.monthlyPriceCents,
          listPriceCents: line.listPriceCents,
          prepayDiscountCentsPerMonth: line.prepayDiscountCentsPerMonth,
        })),
      });
    }
    await tx.auditLog.create({
      data: {
        userId,
        action: "agreement.renewal_draft_created",
        entityType: "RentalAgreement",
        entityId: renewal.id,
        newValue: {
          renewedFromAgreementId: agreement.id,
          termMonths: input.termMonths,
          startOn: input.startOn.toISOString(),
        },
      },
    });
    return { newAgreementId: renewal.id };
  });
}

async function authorizeAutoRenewActor(
  tx: Prisma.TransactionClient,
  userId: string,
  customerUserId: string,
): Promise<void> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, archivedAt: true },
  });
  if (!user || user.archivedAt) {
    throw new Error("This account no longer has access to make that change.");
  }
  if (user.role === "OWNER" || user.role === "ADMIN") return;
  if (user.role === "CUSTOMER" && user.id === customerUserId) return;
  throw new Error("This account cannot change auto-renew for that agreement.");
}

export async function setAutoRenew(
  userId: string,
  agreementId: string,
  input: { enabled: boolean; termsVersion: string },
): Promise<void> {
  const termsVersion = input.termsVersion.trim();
  if (input.enabled && !termsVersion) throw new Error("Auto-renew terms version is required.");

  await prisma.$transaction(async (tx) => {
    await lockAgreement(tx, agreementId);
    const agreement = await tx.rentalAgreement.findUniqueOrThrow({
      where: { id: agreementId },
      include: { customer: { select: { userId: true } } },
    });
    await authorizeAutoRenewActor(tx, userId, agreement.customer.userId);
    if (agreement.status !== "ACTIVE") {
      throw new Error("Auto-renew can only be changed on an active agreement.");
    }
    if (input.enabled && agreement.termMonths === null) {
      throw new Error("Month-to-month agreements do not need auto-renew.");
    }

    if (input.enabled) {
      const settings = await tx.businessSettings.findUnique({
        where: { id: "singleton" },
        select: { autoRenewTermsVersion: true },
      });
      if (!settings?.autoRenewTermsVersion) {
        throw new Error("Auto-renew is not available until terms are configured.");
      }
      if (settings.autoRenewTermsVersion !== termsVersion) {
        throw new Error("Auto-renew terms changed. Review the current terms before consenting.");
      }
    }

    const consentedAt = input.enabled ? new Date() : null;
    await tx.rentalAgreement.update({
      where: { id: agreementId },
      data: {
        renewalPreference: input.enabled ? "AUTO_RENEW" : "NONE",
        autoRenewConsentedAt: consentedAt,
        autoRenewTermsVersion: input.enabled ? termsVersion : null,
      },
    });
    await tx.consentRecord.create({
      data: {
        customerId: agreement.customerId,
        kind: "auto_renew",
        details: {
          agreementId,
          enabled: input.enabled,
          termsVersion: input.enabled ? termsVersion : null,
          actorUserId: userId,
        },
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: input.enabled ? "agreement.auto_renew_enabled" : "agreement.auto_renew_disabled",
        entityType: "RentalAgreement",
        entityId: agreementId,
        newValue: {
          renewalPreference: input.enabled ? "AUTO_RENEW" : "NONE",
          autoRenewTermsVersion: input.enabled ? termsVersion : null,
        },
      },
    });
  });
}

export function canAutoRenewStatus(status: RentalAgreementStatus): boolean {
  return status === "ACTIVE";
}
