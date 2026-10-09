import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addBusinessDays, billingPeriodFor, businessDaysBetween } from "@/lib/business-date";
import { applySubscriptionEnds, recomputeForAgreementInTx } from "@/domains/billing/subscription-end";
import { createNoticeInTx } from "@/domains/notices";
import { composeTermsChangeNotice } from "@/domains/notices/terms-change";
import { lockAgreementForActor, type TermActor } from "./actor";

/**
 * Month-to-month rentals (docs/archive/designs-completed/BATCH-B2.md B2-9, B2-10, B2-11).
 *
 * A month-to-month rental can be ended online by the customer at any time with no fee. It ends on the first billing
 * anniversary on or after (today + the notice days of the terms that apply to it). The ending reuses the same four
 * columns as an early ending, so the nightly job ends it and the billing-end answer stops Stripe one second before.
 */

export type MonthToMonthTerms = { version: number; noticeDays: number; termsText: string };

export type MonthToMonthEndQuote = {
  requestedOn: Date;
  effectiveOn: Date;
  lastBilledDay: Date;
  noticeDays: number;
  termsVersion: number;
  feeCents: 0;
};

const MAX_PERIODS = 600;
const DAY_MS = 86_400_000;

/**
 * The terms that apply to this month-to-month rental right now: the version it started on, or a newer one once the
 * customer's change notice was delivered at least `monthToMonthChangeNoticeDays` days ago. A customer whose notice
 * was never delivered stays on the older terms. Returns null for a fixed-term rental or when no terms are published.
 */
export async function effectiveMonthToMonthTerms(
  tx: Prisma.TransactionClient,
  agreementId: string,
  now: Date,
): Promise<MonthToMonthTerms | null> {
  const agreement = await tx.rentalAgreement.findUnique({
    where: { id: agreementId },
    select: { termMonths: true, monthToMonthTermsVersion: true },
  });
  if (!agreement || agreement.termMonths !== null) return null;
  const versions = await tx.monthToMonthTermsVersion.findMany({ orderBy: { version: "asc" } });
  if (versions.length === 0) return null;
  const base = agreement.monthToMonthTermsVersion ?? versions[0]!.version;
  const settings = await tx.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { monthToMonthChangeNoticeDays: true },
  });
  const waitDays = settings?.monthToMonthChangeNoticeDays ?? 30;

  let effective = versions.find((v) => v.version === base) ?? versions[0]!;
  const newer = versions.filter((v) => v.version > effective.version);
  if (newer.length > 0) {
    const notices = await tx.customerNotice.findMany({
      where: {
        agreementId,
        kind: "TERMS_CHANGE",
        status: "SENT",
        dedupeKey: { in: newer.map((v) => termsChangeKey(v.version, agreementId)) },
      },
      select: { dedupeKey: true, evidenceDate: true, sentAt: true },
    });
    const applied = new Set(
      notices
        .filter((n) => {
          const delivered = n.evidenceDate ?? n.sentAt;
          return delivered !== null && businessDaysBetween(delivered, now) >= waitDays;
        })
        .map((n) => n.dedupeKey),
    );
    for (const v of newer) {
      if (applied.has(termsChangeKey(v.version, agreementId))) effective = v;
    }
  }
  return { version: effective.version, noticeDays: effective.noticeDays, termsText: effective.termsText };
}

export const termsChangeKey = (version: number, agreementId: string) => `terms-change-v${version}-${agreementId}`;

/** The newest published terms version, or null when none has been published. */
export async function newestMonthToMonthVersionInTx(tx: Pick<Prisma.TransactionClient, "monthToMonthTermsVersion">): Promise<number | null> {
  const row = await tx.monthToMonthTermsVersion.findFirst({ orderBy: { version: "desc" }, select: { version: true } });
  return row?.version ?? null;
}

/**
 * Quote ending a month-to-month rental. Pure. The ending date is the first billing anniversary (counted from the next
 * billing date) on or after today plus the notice days. There is no fee.
 */
export function quoteMonthToMonthEnd(
  input: { nextBillingDate: Date; terms: MonthToMonthTerms },
  requestedOn: Date,
): MonthToMonthEndQuote {
  const earliest = addBusinessDays(requestedOn, input.terms.noticeDays);
  let k = 0;
  while (k < MAX_PERIODS && billingPeriodFor(input.nextBillingDate, k).start < earliest) k += 1;
  const effectiveOn = billingPeriodFor(input.nextBillingDate, k).start;
  return {
    requestedOn,
    effectiveOn,
    lastBilledDay: addBusinessDays(effectiveOn, -1),
    noticeDays: input.terms.noticeDays,
    termsVersion: input.terms.version,
    feeCents: 0,
  };
}

function sameQuote(a: MonthToMonthEndQuote, b: MonthToMonthEndQuote): boolean {
  return (
    a.effectiveOn.getTime() === b.effectiveOn.getTime() &&
    a.lastBilledDay.getTime() === b.lastBilledDay.getTime() &&
    a.noticeDays === b.noticeDays &&
    a.termsVersion === b.termsVersion &&
    a.feeCents === b.feeCents
  );
}

/** Read-only quote for a real agreement; null when it cannot be ended this way (not active month-to-month, billing not started). */
export async function getMonthToMonthEndQuote(
  agreementId: string,
  requestedOn: Date = new Date(),
): Promise<MonthToMonthEndQuote | null> {
  return prisma.$transaction(async (tx) => {
    const agreement = await tx.rentalAgreement.findUnique({
      where: { id: agreementId },
      select: { status: true, termMonths: true, nextBillingDate: true, terminationRequestedAt: true },
    });
    if (!agreement || agreement.status !== "ACTIVE" || agreement.termMonths !== null) return null;
    if (!agreement.nextBillingDate || agreement.terminationRequestedAt) return null;
    const terms = await effectiveMonthToMonthTerms(tx, agreementId, requestedOn);
    if (!terms) return null;
    return quoteMonthToMonthEnd({ nextBillingDate: agreement.nextBillingDate, terms }, requestedOn);
  });
}

/**
 * Record a request to end a month-to-month rental. The request time is the server's clock; the quote the person saw
 * must equal a fresh quote made now (except its own timestamp). OWNER/ADMIN may choose an earlier billing anniversary
 * (never earlier than the next one) with a written reason, for example when the customer already returned everything.
 * Does NOT end the agreement: the nightly job ends it on the date through the normal close path.
 */
export async function requestMonthToMonthEnd(
  actor: TermActor,
  agreementId: string,
  quote: MonthToMonthEndQuote,
  options: { earlierEffectiveOn?: Date; reason?: string; now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const reason = options.reason?.trim() ?? "";
  if (options.earlierEffectiveOn) {
    if (actor.kind !== "team") throw new Error("Only the business can choose an earlier ending date.");
    if (reason.length < 5 || reason.length > 500) throw new Error("Give a reason for the earlier ending date (5 to 500 characters).");
  }

  const subscriptionEndIds = await prisma.$transaction(async (tx) => {
    const agreement = await lockAgreementForActor(tx, actor, agreementId);
    if (agreement.status !== "ACTIVE") throw new Error("Only an active rental can be ended.");
    if (agreement.termMonths !== null) {
      throw new Error("This rental has a fixed term. Use the early-ending option for it instead.");
    }
    if (agreement.terminationRequestedAt) throw new Error("An ending has already been requested for this rental.");
    if (!agreement.nextBillingDate) {
      throw new Error("Billing for this rental has not started yet. Please contact the business to end it.");
    }
    const terms = await effectiveMonthToMonthTerms(tx, agreementId, now);
    if (!terms) throw new Error("Ending this rental online isn't available right now. Please contact the business.");
    const current = quoteMonthToMonthEnd({ nextBillingDate: agreement.nextBillingDate, terms }, now);
    if (!sameQuote(current, quote)) {
      throw new Error("The numbers changed since this quote was made. Review the new quote and try again.");
    }

    let effectiveOn = current.effectiveOn;
    if (options.earlierEffectiveOn) {
      const chosen = options.earlierEffectiveOn.getTime();
      let valid = false;
      for (let k = 0; k < MAX_PERIODS; k += 1) {
        const start = billingPeriodFor(agreement.nextBillingDate, k).start.getTime();
        if (start === chosen) valid = true;
        if (start >= current.effectiveOn.getTime()) break;
      }
      if (!valid || chosen > current.effectiveOn.getTime()) {
        throw new Error("Choose a billing date between the next one and the quoted ending date.");
      }
      effectiveOn = options.earlierEffectiveOn;
    }

    const policyVersion = `mtm-v${terms.version}`;
    await tx.rentalAgreement.update({
      where: { id: agreementId },
      data: {
        terminationRequestedAt: now,
        terminationEffectiveOn: effectiveOn,
        terminationFeeCents: 0,
        terminationPolicyVersion: policyVersion,
      },
    });
    await tx.consentRecord.create({
      data: {
        customerId: agreement.customerId,
        kind: "rental_end_request",
        details: {
          agreementId,
          requestedBy: actor.kind,
          requestedOn: now.toISOString(),
          effectiveOn: effectiveOn.toISOString(),
          lastBilledDay: current.lastBilledDay.toISOString(),
          noticeDays: terms.noticeDays,
          termsVersion: terms.version,
          earlier: Boolean(options.earlierEffectiveOn),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: "agreement.month_to_month_end_requested",
        entityType: "RentalAgreement",
        entityId: agreementId,
        newValue: {
          requestedBy: actor.kind,
          requestedOn: now.toISOString(),
          effectiveOn: effectiveOn.toISOString(),
          termsVersion: terms.version,
          ...(options.earlierEffectiveOn ? { earlierBecause: reason } : {}),
        },
      },
    });
    return recomputeForAgreementInTx(tx, agreementId);
  });

  // The decision and its billing answer are already durable together; Stripe catches up after commit.
  await applySubscriptionEnds(subscriptionEndIds);
}

/**
 * Publish the month-to-month terms as the next version when they differ from the newest one, and tell every active
 * month-to-month customer (one TERMS_CHANGE notice each, no sending window). A newer version withdraws an earlier
 * notice that was never sent. Fixed-term rentals are never touched. Runs inside the settings save transaction.
 */
export async function publishMonthToMonthTermsInTx(
  tx: Prisma.TransactionClient,
  userId: string | null,
  terms: { noticeDays: number; termsText: string },
): Promise<{ version: number; notices: number } | null> {
  const newest = await tx.monthToMonthTermsVersion.findFirst({ orderBy: { version: "desc" } });
  if (newest && newest.noticeDays === terms.noticeDays && newest.termsText === terms.termsText) return null;
  const version = (newest?.version ?? 0) + 1;
  await tx.monthToMonthTermsVersion.create({
    data: { version, noticeDays: terms.noticeDays, termsText: terms.termsText, publishedByUserId: userId },
  });
  const [settings, agreements] = await Promise.all([
    tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: {
        publicBusinessName: true,
        publicPhone: true,
        publicEmail: true,
        monthToMonthChangeNoticeDays: true,
        termsChangeNoticeText: true,
      },
    }),
    tx.rentalAgreement.findMany({
      where: { status: "ACTIVE", termMonths: null, terminationRequestedAt: null },
      select: { id: true, customerId: true, customer: { select: { user: { select: { name: true, email: true } } } } },
    }),
  ]);
  let notices = 0;
  for (const agreement of agreements) {
    const key = termsChangeKey(version, agreement.id);
    await tx.customerNotice.updateMany({
      where: { agreementId: agreement.id, kind: "TERMS_CHANGE", status: "PENDING", dedupeKey: { not: key } },
      data: { status: "NOT_NEEDED" },
    });
    const composed = composeTermsChangeNotice({
      customerName: agreement.customer.user.name ?? agreement.customer.user.email,
      noticeDays: terms.noticeDays,
      termsText: terms.termsText,
      changeDays: settings?.monthToMonthChangeNoticeDays ?? 30,
      businessName: settings?.publicBusinessName ?? "Robinson Appliance Rentals",
      businessPhone: settings?.publicPhone ?? "",
      businessEmail: settings?.publicEmail ?? "",
      template: settings?.termsChangeNoticeText,
    });
    const result = await createNoticeInTx(tx, {
      customerId: agreement.customerId,
      agreementId: agreement.id,
      kind: "TERMS_CHANGE",
      dedupeKey: key,
      subject: composed.subject,
      body: composed.body,
      earliestAt: null,
      deadlineAt: null,
    });
    if (result.created) notices += 1;
  }
  await tx.auditLog.create({
    data: {
      userId,
      action: "settings.month_to_month_terms_published",
      entityType: "MonthToMonthTermsVersion",
      entityId: String(version),
      newValue: { version, noticeDays: terms.noticeDays, notices },
    },
  });
  return { version, notices };
}

/** Days between two instants rounded to whole business days (shown on the screens). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}
