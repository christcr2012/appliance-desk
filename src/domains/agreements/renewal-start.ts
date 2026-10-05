import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockCustomerLedger } from "@/domains/billing/ledger";
import {
  applySubscriptionEnd,
  applySubscriptionEnds,
  recomputeForAgreementInTx,
  recomputeSubscriptionEndInTx,
  subscriptionEndCoversRenewal,
} from "@/domains/billing/subscription-end";
import { fixedTermEndDate } from "@/lib/business-date";
import { checkReminderDelivered } from "@/domains/notices";
import { renewalReminderKey } from "@/domains/notices/renewal-reminder";
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
 *     billing date; Batch B2's persisted end intent was already confirmed),
 *     and any deposit carries over,
 *   - the old agreement is marked ENDED (its end date stays the term end) and
 *     the renewal becomes ACTIVE.
 *
 * If the renewal's start date has not arrived, the agreement it renews is no
 * longer active, or old-agreement field work could still change custody, the
 * transaction fails closed and returns the reason to the owner.
 */

export type RenewalStartResult =
  | { started: true; renewalId: string; endedAgreementId: string; appliancesMoved: number }
  | {
      started: false;
      renewalId: string;
      reason:
        | "NOT_SCHEDULED"
        | "NOT_YET"
        | "OLD_NOT_ACTIVE"
        | "NO_RENEWED_FROM"
        | "BILLING_NOT_READY"
        | "AUTO_RENEW_WITHDRAWN"
        | "AUTO_RENEW_OFF"
        | "NOTICE_NOT_SENT"
        | "NOTICE_OUT_OF_WINDOW"
        | "OPEN_JOB_CONFLICT";
      message: string;
    };

const MESSAGES = {
  NOT_SCHEDULED: "This renewal is not waiting to start.",
  NOT_YET: "This renewal's start date has not arrived yet.",
  OLD_NOT_ACTIVE:
    "The rental this renews is no longer active (it was ended or cancelled), so the renewal cannot start. Review it and cancel or fix it.",
  NO_RENEWED_FROM: "This agreement is not a renewal of another agreement.",
  NOTICE_NOT_SENT:
    "The customer has not yet been sent the renewal reminder, so this automatic renewal is on hold. Send it (or mark it as delivered) under Notices, and the renewal will start on its own.",
  NOTICE_OUT_OF_WINDOW:
    "The renewal reminder reached the customer outside the 25 to 40 days before the renewal that Colorado asks for, so this automatic renewal will not start by itself. Cancel the renewal (the customer's rental then simply ends or you renew it by hand) or ask your attorney how to proceed.",
  AUTO_RENEW_OFF:
    "Automatic renewals are switched off (Settings → Ending and renewing rentals). This renewal waits until you turn them on, or you can cancel it.",
  AUTO_RENEW_WITHDRAWN:
    "The customer turned auto-renew off or asked to end the rental, so this automatic renewal will not start. It is cancelled automatically.",
  BILLING_NOT_READY:
    "Waiting for the card processor to confirm the renewal's billing end date. It is retried automatically; nothing was changed.",
  OPEN_JOB_CONFLICT:
    "This rental still has an open delivery, installation, or removal visit that could change equipment custody. Complete or cancel that visit before starting the renewal.",
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

  // A delivery/installation/removal still tied to the old agreement can change
  // physical custody after the assignments move. Fail closed instead of
  // guessing whether old field work should act on the renewed rental. SWAP is
  // intentionally excluded: Batch C explicitly allows a staged swap to follow
  // the appliance's current assignment across renewal.
  const conflictingJob = await tx.job.findFirst({
    where: {
      agreementId: old.id,
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      type: { in: ["DELIVERY", "INSTALLATION", "REMOVAL"] },
    },
    select: { id: true, type: true, status: true },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
  });
  if (conflictingJob) {
    return {
      started: false,
      renewalId,
      reason: "OPEN_JOB_CONFLICT",
      message: `${MESSAGES.OPEN_JOB_CONFLICT} Open ${conflictingJob.type.toLowerCase().replaceAll("_", " ")} job ${conflictingJob.id} is ${conflictingJob.status.toLowerCase().replaceAll("_", " ")}.`,
    };
  }

  // An automatic renewal exists only because the customer agreed to it: if they changed their mind, it never starts.
  if (renewal.createdByAutoRenew && (old.renewalPreference !== "AUTO_RENEW" || old.terminationRequestedAt)) {
    return fail("AUTO_RENEW_WITHDRAWN");
  }

  // The owner's master switch: with it off, no automatic renewal starts (cancelling and opting out still work).
  if (
    renewal.createdByAutoRenew &&
    !(await tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { autoRenewEnabled: true },
    }))?.autoRenewEnabled
  ) {
    return fail("AUTO_RENEW_OFF");
  }

  // Colorado asks for a reminder 25-40 days before an automatic renewal: never renew without one.
  if (renewal.createdByAutoRenew && old.endDate) {
    const check = await checkReminderDelivered(tx, renewalReminderKey(old.id, old.endDate), renewal.startDate);
    if (check === "NOT_DELIVERED") return fail("NOTICE_NOT_SENT");
    if (check === "OUT_OF_WINDOW") return fail("NOTICE_OUT_OF_WINDOW");
  }

  // The persisted answer must already be the one this renewal needs. This replaces
  // the old per-renewal provider-operation key check and cannot be fooled by a
  // stale extend/revert operation finishing out of order.
  if (
    old.stripeSubscriptionId &&
    !(await subscriptionEndCoversRenewal(tx, old.stripeSubscriptionId, renewal))
  ) {
    return fail("BILLING_NOT_READY");
  }

  const oldLines = await tx.rentalLine.findMany({
    where: { agreementId: old.id },
    include: { assignments: { where: { unassignedAt: null } } },
  });
  const newLines = await tx.rentalLine.findMany({
    where: { agreementId: renewal.id },
    include: { assignments: { where: { unassignedAt: null } } },
  });
  if (newLines.some((line) => line.assignments.length > 0)) {
    throw new Error(
      "The renewal already has equipment assigned to its own lines. Remove those assignments (the equipment moves over from the current rental automatically) and try again. Nothing was changed.",
    );
  }
  const pairs = pairLines(oldLines, newLines);

  // Lock the units that change assignment (spec lock order: agreement, then appliances sorted by id), so a job
  // completing for one of them at this moment waits. Custody is NOT touched: nothing physical moves.
  const movingApplianceIds = [...new Set(oldLines.flatMap((line) => line.assignments.map((a) => a.applianceId)))].sort();
  if (movingApplianceIds.length > 0) {
    await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ANY(${movingApplianceIds}) ORDER BY "id" FOR UPDATE`;
  }

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

  // The holder changed, so persist the newly derived answer in the same hand-off
  // transaction. The date normally stays identical; after commit the fenced worker
  // confirms the new version without sending an unnecessary Stripe update.
  if (old.stripeSubscriptionId) {
    await recomputeSubscriptionEndInTx(tx, old.stripeSubscriptionId);
  }

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
  const current = await prisma.rentalAgreement.findUnique({
    where: { id: renewalId },
    select: {
      status: true,
      createdByAutoRenew: true,
      renewedFromAgreementId: true,
    },
  });

  // Re-derive and converge before attempting the hand-off. This is safe even
  // for a withdrawn automatic renewal: the answer becomes the old term end,
  // never an extension.
  if (current?.status === "SCHEDULED" && current.renewedFromAgreementId) {
    const ids = await prisma.$transaction((tx) =>
      recomputeForAgreementInTx(tx, current.renewedFromAgreementId!),
    );
    await applySubscriptionEnds(ids);
  }

  const result = await prisma.$transaction((tx) => startRenewalInTx(tx, renewalId, now));
  if (result.started) {
    const moved = await prisma.rentalAgreement.findUnique({
      where: { id: renewalId },
      select: { stripeSubscriptionId: true },
    });
    if (moved?.stripeSubscriptionId) await applySubscriptionEnd(moved.stripeSubscriptionId);
  }
  return result;
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
