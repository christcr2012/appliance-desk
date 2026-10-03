import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockCustomerLedger } from "@/domains/billing/ledger";
import { syncSubscriptionTerm, termSyncKey } from "@/domains/billing/subscription-term";
import { fixedTermEndDate } from "@/lib/business-date";
import { lockRentalAgreementInTx } from "./index";

/**
 * Starting a signed renewal.
 *
 * A renewal can be signed weeks before the rental it continues ends. Until its
 * start date it is SCHEDULED: it is not an active rental, is not counted as
 * revenue, and does not touch the appliances, which stay with the current
 * agreement. On its start date (checked every night, and right after signing
 * if the start date has already arrived) this hand-off happens in ONE database
 * transaction, so there is never a moment with two active rentals or none:
 *
 *   - the appliances move from the old agreement's lines to the renewal's lines
 *     (they stay exactly where they are; nothing is sent for pickup),
 *   - the monthly billing carries over (same Stripe subscription, same next
 *     billing date; its end date was already moved to the renewal's end when the
 *     renewal was signed), and any deposit carries over,
 *   - the old agreement is marked ENDED (its end date stays the term end) and
 *     the renewal becomes ACTIVE.
 *
 * If the renewal's start date has not arrived, or the agreement it renews is no
 * longer active (ended or cancelled early), nothing changes and the reason is
 * returned so the owner can be told.
 */

export type RenewalStartResult =
  | { started: true; renewalId: string; endedAgreementId: string; appliancesMoved: number }
  | { started: false; renewalId: string; reason: "NOT_SCHEDULED" | "NOT_YET" | "OLD_NOT_ACTIVE" | "NO_RENEWED_FROM" | "BILLING_NOT_READY"; message: string };

const MESSAGES = {
  NOT_SCHEDULED: "This renewal is not waiting to start.",
  NOT_YET: "This renewal's start date has not arrived yet.",
  OLD_NOT_ACTIVE:
    "The rental this renews is no longer active (it was ended or cancelled), so the renewal cannot start. Review it and cancel or fix it.",
  NO_RENEWED_FROM: "This agreement is not a renewal of another agreement.",
  BILLING_NOT_READY:
    "Waiting for the card processor to confirm the renewal's new end date on the monthly billing. It is retried automatically; nothing was changed.",
} as const;

type Line = { id: string; label: string; monthlyPriceCents: number };

/** Pair each old line with an interchangeable renewal line (same label and price), one to one. */
function pairLines(oldLines: Line[], newLines: Line[]): Map<string, string> {
  const free = [...newLines];
  if (newLines.length !== oldLines.length) {
    throw new Error(
      "The renewal has a different number of rental lines than the rental it renews. Nothing was changed; make the lines match and try again.",
    );
  }
  const pairs = new Map<string, string>();
  for (const line of oldLines) {
    const index = free.findIndex(
      (candidate) => candidate.label === line.label && candidate.monthlyPriceCents === line.monthlyPriceCents,
    );
    if (index === -1) {
      throw new Error(
        `Could not match the rental line "${line.label}" on the renewal. Nothing was changed; fix the renewal's lines and try again.`,
      );
    }
    pairs.set(line.id, free[index].id);
    free.splice(index, 1);
  }
  return pairs;
}

export async function startRenewalInTx(
  tx: Prisma.TransactionClient,
  renewalId: string,
  now: Date,
): Promise<RenewalStartResult> {
  const peek = await tx.rentalAgreement.findUnique({
    where: { id: renewalId },
    select: { customerId: true },
  });
  if (!peek) throw new Error("Couldn't find that rental agreement.");
  // Same order as the billing code: the customer first, then the agreements.
  await lockCustomerLedger(tx, peek.customerId);

  const renewal = await lockRentalAgreementInTx(tx, renewalId);
  const fail = (reason: keyof typeof MESSAGES): RenewalStartResult => ({
    started: false,
    renewalId,
    reason,
    message: MESSAGES[reason],
  });
  if (renewal.status !== "SCHEDULED") return fail("NOT_SCHEDULED");
  if (!renewal.renewedFromAgreementId) return fail("NO_RENEWED_FROM");
  if (!renewal.startDate || renewal.startDate.getTime() > now.getTime()) return fail("NOT_YET");

  const old = await lockRentalAgreementInTx(tx, renewal.renewedFromAgreementId);
  if (old.status !== "ACTIVE") return fail("OLD_NOT_ACTIVE");

  // The subscription keeps charging only if its end date was moved at signing.
  if (old.stripeSubscriptionId) {
    const confirmed = await tx.providerOperation.findUnique({
      where: { idempotencyKey: termSyncKey(renewal.id, "extend") },
      select: { status: true },
    });
    if (confirmed?.status !== "SUCCEEDED") return fail("BILLING_NOT_READY");
  }

  const oldLines = await tx.rentalLine.findMany({
    where: { agreementId: old.id },
    include: { assignments: { where: { unassignedAt: null } } },
  });
  const newLines = await tx.rentalLine.findMany({
    where: { agreementId: renewal.id },
    include: { assignments: { where: { unassignedAt: null } } },
  });
  // The draft was edited with the normal editor: equipment reserved directly on
  // the renewal would be left behind, so the owner has to sort it out first.
  if (newLines.some((line) => line.assignments.length > 0)) {
    throw new Error(
      "The renewal already has equipment assigned to its own lines. Remove those assignments (the equipment moves over from the current rental automatically) and try again. Nothing was changed.",
    );
  }
  const pairs = pairLines(oldLines, newLines);

  let appliancesMoved = 0;
  for (const line of oldLines) {
    for (const assignment of line.assignments) {
      await tx.applianceAssignment.update({
        where: { id: assignment.id },
        data: { unassignedAt: now, unassignReason: "Moved to the renewal" },
      });
      await tx.applianceAssignment.create({
        data: { rentalLineId: pairs.get(line.id)!, applianceId: assignment.applianceId, assignedAt: now },
      });
      appliancesMoved += 1;
    }
  }

  // The subscription id is unique, so clear it on the old agreement first.
  await tx.rentalAgreement.update({
    where: { id: old.id },
    data: {
      status: "ENDED",
      stripeSubscriptionId: null,
      nextBillingDate: null,
      billingBlockedReason: null,
    },
  });
  await tx.rentalAgreement.update({
    where: { id: renewal.id },
    data: {
      status: "ACTIVE",
      stripeSubscriptionId: old.stripeSubscriptionId,
      nextBillingDate: old.nextBillingDate,
      // The renewal's own billing history starts at its start date, so reports
      // never count the same rental twice for the months the old one covered.
      billingStartedAt: old.billingStartedAt ? renewal.startDate : null,
      endDate: renewal.endDate ?? (renewal.termMonths ? fixedTermEndDate(renewal.startDate, renewal.termMonths) : null),
      billingBlockedReason: old.billingBlockedReason,
      billingReminderSentForDate: old.billingReminderSentForDate,
    },
  });
  await tx.deposit.updateMany({ where: { agreementId: old.id }, data: { agreementId: renewal.id } });

  await tx.auditLog.create({
    data: {
      userId: null,
      action: "agreement.renewal_started",
      entityType: "RentalAgreement",
      entityId: renewal.id,
      newValue: {
        renewedFromAgreementId: old.id,
        appliancesMoved,
        subscriptionMoved: Boolean(old.stripeSubscriptionId),
      },
    },
  });
  return { started: true, renewalId, endedAgreementId: old.id, appliancesMoved };
}

export async function startRenewalIfDue(renewalId: string, now = new Date()): Promise<RenewalStartResult> {
  // Make sure the subscription's end date has been moved (normally done when the
  // renewal was signed; this retries it, and is a no-op once confirmed).
  const current = await prisma.rentalAgreement.findUnique({ where: { id: renewalId }, select: { status: true } });
  if (current?.status === "SCHEDULED") await syncSubscriptionTerm(renewalId, "extend");
  return prisma.$transaction((tx) => startRenewalInTx(tx, renewalId, now));
}

/** Nightly job: start every signed renewal whose start date has arrived. One failure never blocks the others. */
export async function startDueRenewals(now = new Date()): Promise<{
  started: number;
  blocked: Array<{ renewalId: string; message: string }>;
}> {
  const due = await prisma.rentalAgreement.findMany({
    where: { status: "SCHEDULED", renewedFromAgreementId: { not: null }, startDate: { lte: now } },
    select: { id: true },
    orderBy: { startDate: "asc" },
  });
  let started = 0;
  const blocked: Array<{ renewalId: string; message: string }> = [];
  for (const { id } of due) {
    try {
      const result = await startRenewalIfDue(id, now);
      if (result.started) started += 1;
      else blocked.push({ renewalId: id, message: result.message });
    } catch (error) {
      blocked.push({ renewalId: id, message: error instanceof Error ? error.message : "Unknown error" });
    }
  }
  return { started, blocked };
}
