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
  | "RENEWAL_NOT_STARTED";

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
