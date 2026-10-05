// ---------------------------------------------------------------------------
// Exception inbox (2026-09-28) — one place that surfaces anything stuck or
// needing Chris's attention, instead of him having to remember to go check
// six different pages. Pure, zero-database-import rules here (same pattern
// as src/domains/inventory/lifecycle.ts, src/domains/agreements/
// reservation-status.ts) so they're simple to unit-test; src/domains/
// exceptions/index.ts is the thin DB wrapper that queries real rows and
// runs them through these.
//
// Every category here is something that was ALREADY possible before this
// file existed (a stuck reservation, a blocked billing start, a past-due
// invoice, a missed job, an unreviewed request, a machine sitting
// uninspected) — this doesn't add new failure states, it just collects the
// existing ones into one list instead of leaving Chris to notice them by
// accident on whichever page he happens to open.
// ---------------------------------------------------------------------------

export type ExceptionCategory =
  | "BILLING_BLOCKED"
  | "STALE_RESERVATION"
  | "PAST_DUE_INVOICE"
  | "OVERDUE_JOB"
  | "UNREVIEWED_MAINTENANCE_REQUEST"
  | "UNINSPECTED_RETURN"
  | "MISSING_REPAIR_COST"
  | "AGREEMENT_TERM_EXPIRED"
  | "APPLIANCE_MAINTENANCE_DUE"
  | "RENEWAL_NOT_STARTED"
  | "EARLY_ENDING_NOT_DONE"
  | "NOTICE_WAITING"
  | "NOTICE_MISSED"
  | "NOTICE_UNCERTAIN"
  | "NOTICE_FAILED"
  | "ITEM_NOT_DELIVERED"
  | "RETURNED_EARLY"
  | "SUBSCRIPTION_UPDATE_PENDING"
  | "CUSTODY_UNKNOWN";

export type ExceptionSeverity = "high" | "medium";

export type ExceptionItem = {
  category: ExceptionCategory;
  severity: ExceptionSeverity;
  title: string;
  detail: string;
  /** Where "Fix this" should send Chris. */
  href: string;
  /** For sorting oldest-first within a category. */
  since: Date;
};

// Thresholds — deliberately simple, explainable numbers (docs/BUSINESS-
// RULES.md's lead-scoring section sets the same expectation for any rule
// like this: no hidden math, a number Chris could recite back). Not tied
// to BusinessSettings since these are about Chris's own workflow, not a
// customer-facing policy like lateFeeGraceDays.
export const UNREVIEWED_MAINTENANCE_REQUEST_DAYS = 2;
export const UNINSPECTED_RETURN_DAYS = 3;
// How long a rental whose early return was settled by the owner's standard choices stays on Today for a second look.
export const EARLY_RETURN_DEFAULTS_REVIEW_DAYS = 14;
// Automation rules (Task #67, docs/DECISIONS.md 2026-09-28, Chris's pick
// of the three most useful checks to run automatically). 180 days (~6
// months) is a simple, explainable "it's been a while" bar for a rented
// appliance with no logged maintenance visit — not a manufacturer service
// schedule, since none is tracked per appliance type today.
export const APPLIANCE_MAINTENANCE_DUE_DAYS = 180;

export function billingBlockedException(agreement: {
  id: string;
  billingBlockedReason: string;
  updatedAt: Date;
  customerName: string;
}): ExceptionItem {
  return {
    category: "BILLING_BLOCKED",
    severity: "high",
    title: `Billing couldn't start for ${agreement.customerName}`,
    detail: agreement.billingBlockedReason,
    href: `/desk/agreements/${agreement.id}`,
    since: agreement.updatedAt,
  };
}

/** A signed renewal whose start date passed over a day ago but that has not started (the nightly job could not start it). */
export const RENEWAL_START_GRACE_DAYS = 1;

export function renewalNotStartedException(agreement: {
  id: string;
  startDate: Date;
  customerName: string;
}): ExceptionItem {
  return {
    category: "RENEWAL_NOT_STARTED",
    severity: "high",
    title: `${agreement.customerName}'s renewal did not start on its start date`,
    detail:
      "The renewal is signed but could not take over from the rental it renews (that rental may have been ended or cancelled early). Open it to cancel or fix it.",
    href: `/desk/agreements/${agreement.id}`,
    since: agreement.startDate,
  };
}

/**
 * An agreement item was not on the delivery visit that started billing and is
 * still waiting (owner decision IN-26). The customer is being billed for it, so
 * it must never be forgotten: schedule a delivery job for it, and when that job
 * is completed the credit for the missing days is worked out automatically.
 */
export function itemNotDeliveredException(item: {
  originalJobId: string;
  itemLabel: string;
  originalDeliveryDate: Date;
  customerName: string;
}): ExceptionItem {
  return {
    category: "ITEM_NOT_DELIVERED",
    severity: "high",
    title: `${item.itemLabel} has not been delivered to ${item.customerName} yet`,
    detail:
      "The customer is billed for it from the original delivery date. Schedule a delivery job for it; completing that job credits the customer for the days it was missing.",
    href: `/desk/jobs/${item.originalJobId}`,
    since: item.originalDeliveryDate,
  };
}

/**
 * Everything came back before the agreed ending (docs/designs/BATCH-B2.md B2-19). Until the owner chooses, billing
 * carries on; with "apply my defaults" the choice was already made and can still be changed for a short while.
 */
export function returnedEarlyException(item: {
  agreementId: string;
  customerName: string;
  since: Date;
  settled: boolean;
}): ExceptionItem {
  return {
    category: "RETURNED_EARLY",
    severity: item.settled ? "medium" : "high",
    title: item.settled
      ? `${item.customerName}'s equipment came back early — your standard choices were applied`
      : `${item.customerName}'s equipment came back early — choose what to do`,
    detail: item.settled
      ? "Check what was done. You can still change it while no money has been refunded or credited and no fee has been paid."
      : "Billing continues until you decide. Choose whether billing stops now or runs to the agreed ending, what happens to days already paid for, and whether an early-ending fee applies.",
    href: `/desk/agreements/${item.agreementId}/early-return`,
    since: item.since,
  };
}

/**
 * An item was cancelled (never delivered, taken off the agreement) but Stripe has not yet lowered the
 * customer's monthly subscription. The system keeps retrying; this keeps the owner aware until it is done.
 */
export function subscriptionUpdatePendingException(item: {
  originalJobId: string;
  itemLabel: string;
  customerName: string;
  since: Date;
}): ExceptionItem {
  return {
    category: "SUBSCRIPTION_UPDATE_PENDING",
    severity: "high",
    title: `${item.customerName}'s monthly bill has not been lowered yet for cancelled ${item.itemLabel}`,
    detail:
      "The item was cancelled and the customer was credited, but Stripe still has the old monthly amount. The system keeps retrying and the Billing check screen shows it until it is done.",
    href: `/desk/jobs/${item.originalJobId}`,
    since: item.since,
  };
}

/**
 * An appliance is marked as out with a customer (or waiting to be picked up) but the system cannot tell
 * which customer has it. The owner records who has it (a manual custody entry) on the appliance page.
 */
export function custodyUnknownException(appliance: { id: string; label: string; since: Date }): ExceptionItem {
  return {
    category: "CUSTODY_UNKNOWN",
    severity: "medium",
    title: `We don't know which customer has ${appliance.label}`,
    detail:
      "It is marked as rented, but no delivery record says who has it. Open it and record which customer it is with, so pickups and repairs can find it.",
    href: `/desk/inventory/${appliance.id}`,
    since: appliance.since,
  };
}

/** An agreed early-ending date passed but the rental is still active (prepaid months to settle, or the nightly job could not end it). */
export function earlyEndingNotDoneException(agreement: {
  id: string;
  terminationEffectiveOn: Date;
  customerName: string;
  prepaid: boolean;
}): ExceptionItem {
  return {
    category: "EARLY_ENDING_NOT_DONE",
    severity: "high",
    title: `${agreement.customerName}'s early ending has not been carried out`,
    detail: agreement.prepaid
      ? "This rental was paid in advance, so the unused months need your decision (refund, credit or keep) before it can end. Open it to settle that and end the rental."
      : "The agreed ending date has passed but the rental is still active. Open it to end it.",
    href: `/desk/agreements/${agreement.id}`,
    since: agreement.terminationEffectiveOn,
  };
}

/** A message the customer is owed that has not been delivered (live email is off, or the owner has not marked it sent). */
export function noticeWaitingException(notice: {
  id: string;
  customerName: string;
  createdAt: Date;
  kind?: string;
}): ExceptionItem {
  if (notice.kind === "ANNUAL_REMINDER" || notice.kind === "TERMS_CHANGE") {
    return {
      category: "NOTICE_WAITING",
      severity: "high",
      title: `${notice.customerName} has ${notice.kind === "ANNUAL_REMINDER" ? "a yearly reminder" : "a notice about changed terms"} waiting to be sent`,
      detail:
        "Billing is not affected. Send it yourself and mark it as delivered, or turn on live customer email.",
      href: "/desk/notices",
      since: notice.createdAt,
    };
  }
  return {
    category: "NOTICE_WAITING",
    severity: "high",
    title: `${notice.customerName} has a renewal reminder waiting to be sent`,
    detail:
      "Their automatic renewal will not start until this reminder is delivered. Send it yourself and mark it as delivered, or turn on live customer email.",
    href: "/desk/notices",
    since: notice.createdAt,
  };
}

/**
 * A reminder that did not reach the customer cleanly. All three open the same "Fix a missed reminder" screen,
 * which offers every option (docs/designs/BATCH-B2.md B2-18).
 */
export function noticeProblemException(
  status: "MISSED" | "UNCERTAIN" | "FAILED",
  notice: { id: string; customerName: string; createdAt: Date; kind?: string },
): ExceptionItem {
  const label =
    notice.kind === "ANNUAL_REMINDER" ? "yearly reminder" : notice.kind === "TERMS_CHANGE" ? "notice about changed terms" : "renewal reminder";
  const copy = {
    MISSED: {
      category: "NOTICE_MISSED" as const,
      title: `${notice.customerName}'s ${label} was not delivered in time`,
      detail:
        notice.kind === "ANNUAL_REMINDER" || notice.kind === "TERMS_CHANGE"
          ? "The last day to send it passed, so it will not be sent now. Billing carries on as normal. Open it to record that you delivered it another way, or to leave it."
          : "The last day to send it passed. It will never be sent now (it would promise a renewal that cannot start), the automatic renewal will not start on its own, and billing ends on the current end date. Open it to choose what happens next.",
    },
    UNCERTAIN: {
      category: "NOTICE_UNCERTAIN" as const,
      title: `${notice.customerName}'s ${label} may or may not have gone out`,
      detail:
        "The email service did not give a clear answer. Check whether it was delivered, then say so on the next screen. Nothing is sent again by itself.",
    },
    FAILED: {
      category: "NOTICE_FAILED" as const,
      title: `${notice.customerName}'s ${label} was refused three times`,
      detail:
        "The email service refused it every time (often a wrong email address). Fix the address and try again, or deliver it another way.",
    },
  }[status];
  return {
    category: copy.category,
    severity: "high",
    title: copy.title,
    detail: copy.detail,
    href: `/desk/notices/${notice.id}/resolve`,
    since: notice.createdAt,
  };
}

export function staleReservationException(agreement: {
  id: string;
  reservationExpiresAt: Date;
  customerName: string;
}): ExceptionItem {
  return {
    category: "STALE_RESERVATION",
    severity: "medium",
    title: `${agreement.customerName}'s reservation hold has expired`,
    detail:
      "This draft is holding equipment that could go to someone else — sign it, extend the hold, or cancel it.",
    href: `/desk/agreements/${agreement.id}`,
    since: agreement.reservationExpiresAt,
  };
}

export function pastDueInvoiceException(invoice: {
  id: string;
  customerId: string;
  customerName: string;
  dueDate: Date;
  amountDueCents: number;
  amountPaidCents: number;
}): ExceptionItem {
  const owedCents = invoice.amountDueCents - invoice.amountPaidCents;
  return {
    category: "PAST_DUE_INVOICE",
    severity: "high",
    title: `${invoice.customerName} has a past-due invoice`,
    detail: `$${(owedCents / 100).toFixed(2)} owed, due ${invoice.dueDate.toLocaleDateString("en-US")}.`,
    href: `/desk/customers/${invoice.customerId}`,
    since: invoice.dueDate,
  };
}

export function overdueJobException(job: {
  id: string;
  type: string;
  scheduledAt: Date;
  customerName: string | null;
}): ExceptionItem {
  return {
    category: "OVERDUE_JOB",
    severity: "medium",
    title: `${job.type.replace(/_/g, " ").toLowerCase()} job is overdue`,
    detail: `Scheduled for ${job.scheduledAt.toLocaleDateString("en-US")}${job.customerName ? ` (${job.customerName})` : ""} but never marked in progress or completed.`,
    href: `/desk/jobs/${job.id}`,
    since: job.scheduledAt,
  };
}

export function unreviewedMaintenanceRequestException(request: {
  id: string;
  openedAt: Date;
  customerName: string;
  problem: string;
}): ExceptionItem {
  return {
    category: "UNREVIEWED_MAINTENANCE_REQUEST",
    severity: "medium",
    title: `${request.customerName}'s repair request hasn't been reviewed`,
    detail: request.problem,
    href: `/desk/maintenance/${request.id}`,
    since: request.openedAt,
  };
}

export function uninspectedReturnException(appliance: {
  id: string;
  assetNumber: string;
  applianceTypeName: string;
  updatedAt: Date;
}): ExceptionItem {
  return {
    category: "UNINSPECTED_RETURN",
    severity: "medium",
    title: `${appliance.applianceTypeName} (${appliance.assetNumber}) is back but hasn't been inspected`,
    detail: "It's sitting AWAITING_INSPECTION — it can't go back out to another customer until it's checked over.",
    href: `/desk/inventory/${appliance.id}`,
    since: appliance.updatedAt,
  };
}

export function missingRepairCostException(job: {
  id: string;
  completedAt: Date;
  applianceLabel: string | null;
}): ExceptionItem {
  return {
    category: "MISSING_REPAIR_COST",
    severity: "medium",
    title: `Repair cost not logged${job.applianceLabel ? ` (${job.applianceLabel})` : ""}`,
    detail:
      "This repair job is marked Completed but has no parts/labor cost entered — appliance profitability (Fleet page) is undercounting it as $0 until you add it.",
    href: `/desk/jobs/${job.id}`,
    since: job.completedAt,
  };
}

/** A fixed-term agreement (e.g. 12 months) whose term end date has
 * passed but is still marked ACTIVE — nobody recorded a renewal, a
 * switch to month-to-month, or an end. Purely a "someone should look at
 * this" flag; it never changes the agreement itself. */
export function agreementTermExpiredException(agreement: {
  id: string;
  customerName: string;
  termMonths: number;
  termEndDate: Date;
}): ExceptionItem {
  return {
    category: "AGREEMENT_TERM_EXPIRED",
    severity: "medium",
    title: `${agreement.customerName}'s ${agreement.termMonths}-month term has ended`,
    detail: `Term ended ${agreement.termEndDate.toLocaleDateString("en-US")} but the agreement is still marked active — check whether they're renewing, going month-to-month, or returning the equipment.`,
    href: `/desk/agreements/${agreement.id}`,
    since: agreement.termEndDate,
  };
}

/** A currently-rented appliance with no logged maintenance visit (or
 * none since it went into service) in over
 * APPLIANCE_MAINTENANCE_DUE_DAYS. */
export function applianceMaintenanceDueException(appliance: {
  id: string;
  assetNumber: string;
  applianceTypeName: string;
  sinceDate: Date;
}): ExceptionItem {
  return {
    category: "APPLIANCE_MAINTENANCE_DUE",
    severity: "medium",
    title: `${appliance.applianceTypeName} (${appliance.assetNumber}) may be due for a maintenance check`,
    detail: `No completed maintenance visit logged since ${appliance.sinceDate.toLocaleDateString("en-US")} — worth scheduling a routine check-in with the customer.`,
    href: `/desk/inventory/${appliance.id}`,
    since: appliance.sinceDate,
  };
}

/** Oldest first within a category, but overall sorted high severity
 * first, then by how long it's been sitting. */
export function sortExceptions(items: ExceptionItem[]): ExceptionItem[] {
  return [...items].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
    return a.since.getTime() - b.since.getTime();
  });
}
