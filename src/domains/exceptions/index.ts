import { listPaperworkAttention } from "@/domains/paperwork";
import { readDefaultJobMinutes } from "@/domains/jobs/scheduling";
import { todoAction, todoDeadlineLabel, todoKey } from "./todo";
import { businessDateKey, businessDayBounds, businessDaysBetween } from "@/lib/business-date";
import { TAX_ADDRESS_CHANGE_REVIEW_NOTE } from "@/domains/tax/address-recheck";
import { listOfficialRateAttention } from "@/domains/tax/official-rate-auto-apply";
import { listPendingRdfSwitches } from "@/domains/tax/rdf-switches";
import { listRuleChangeAttention } from "@/domains/rules/observations";
import { ruleDef } from "@/domains/rules/registry";
import { listTaxFilingAttention, listRdfRefundAttention, listUseTaxResetAttention, listExpiredExemptionAttention, listFilingFrequencyAdviceAttention } from "@/domains/tax/filing-attention";
import { listTaxAmendmentAttention } from "@/domains/tax/amendment-attention";
import { listAcquisitionTaxAttention } from "@/domains/tax/acquisition-attention";
import { listRetiredPlanAttention } from "./retired-attention";
import { listRecallAttention } from "./recall-attention";
import { listBooksAttention, listBooksSetupAttention, listBooksMonthReviewAttention } from "./books-attention";
import { listResaleTaxAttention } from "./resale-tax-attention";
import { listApprovalAttention } from "./approval-attention";
import { listGoalAttention } from "./goal-attention";
import { prisma } from "@/lib/prisma";
import { listSigningPaymentAttention } from "./signing-payment-attention";
import { listCancellationRefundAttention } from "./cancellation-refund-attention";
import { listSignedDeliveryAttention } from "./signed-delivery-attention";
import { listFeedbackWaiting } from "./feedback-attention";
import { listNewLeadContact, listLeadFollowUps, listApprovedQuoteToRental } from "./lead-turning-points";
import { listComplianceDue } from "./compliance-attention";
import { listHeldPaymentAttention, listDepositDecisionAttention } from "./money-turning-points";
import { listUnsignedAgreements } from "./unsigned-agreements";
import { listRentalEndingSoon, listPickupUnscheduled, listVisitNeedsAssignment, listCleaningNeeded } from "./turning-points-attention";
import { requireRole } from "@/lib/session";
import { listBankPaymentSlow } from "./bank-payment-attention";
import { listDisputeAttention } from "./dispute-attention";
import { listLateFeeReview } from "./late-fee-attention";
import { listStartingValuesAttention } from "@/domains/decisions/attention";
import { notInFlightWhere } from "@/domains/billing/in-flight";
import type { Prisma } from "@prisma/client";
import {
  APPLIANCE_MAINTENANCE_DUE_DAYS,
  UNINSPECTED_RETURN_DAYS,
  UNREVIEWED_MAINTENANCE_REQUEST_DAYS,
  agreementTermExpiredException,
  applianceMaintenanceDueException,
  billingBlockedException,
  custodyUnknownException,
  earlyEndingNotDoneException,
  itemNotDeliveredException,
  invoiceTaxBlockedException,
  stripeTaxMismatchException,
  stripeTaxUnverifiedException,
  taxExemptionExpiryException,
  taxExemptionExpiryWindow,
  taxExemptionWarningSince,
  taxAddressChangedException,
  taxRateReviewReminderException,
  officialRateReviewException,
  officialRateScheduledException,
  ruleChangeReviewException,
  rdfSwitchException,
  taxSourceChangedException,
  taxSourceUnreachableException,
  returnedEarlyException,
  EARLY_RETURN_DEFAULTS_REVIEW_DAYS,
  subscriptionUpdatePendingException,
  noticeWaitingException,
  noticeProblemException,
  missingRepairCostException,
  overdueJobException,
  pastDueInvoiceException,
  renewalNotStartedException,
  RENEWAL_START_GRACE_DAYS,
  sortExceptions,
  staleReservationException,
  uninspectedReturnException,
  oldSetApplianceException,
  outOfServiceException,
  unreviewedMaintenanceRequestException,
  customerContact,
  type ExceptionCategory,
  type ExceptionItem,
} from "./rules";
import { OLD_SET_TYPE_SLUG, packageContents } from "@/domains/packages/pricing";

export type { ExceptionItem, ExceptionCategory, ExceptionSeverity } from "./rules";

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function customerDisplayName(customer: { user: { name: string | null; email: string } }): string {
  return customer.user.name ?? customer.user.email;
}

/**
 * R17: technical safety cap, not owner policy. Each category loads at most this many of its OLDEST
 * items (the ones that have waited longest), in a stable order (oldest first, then id). If a category
 * has more, its true total is counted separately so the screen can say so.
 */
export const EXCEPTION_CATEGORY_CAP = 50;

export type ExceptionTruncation = { category: ExceptionCategory; total: number; shown: number };
export type ExceptionOverview = { items: ExceptionItem[]; snoozed: ExceptionItem[]; truncated: ExceptionTruncation[] };

type Capped<T> = { rows: T[]; total: number };

/** One bounded read: `find` is limited to the cap; the total is only counted when the cap was reached. */
async function capped<T>(find: (take: number) => Promise<T[]>, count: () => Promise<number>): Promise<Capped<T>> {
  const rows = await find(EXCEPTION_CATEGORY_CAP);
  if (rows.length < EXCEPTION_CATEGORY_CAP) return { rows, total: rows.length };
  return { rows, total: await count() };
}

// Same key format as lineReduceKey in domains/billing/subscription-line (a test keeps the two in step);
// repeated here so Today does not load the billing code.
export const LINE_REDUCE_KEY_PREFIX = "subscription-line-reduce-";
const parseLineReduceKey = (key: string): string | null =>
  key.startsWith(LINE_REDUCE_KEY_PREFIX) ? key.slice(LINE_REDUCE_KEY_PREFIX.length) : null;

export type ReturnedEarlyRow = { agreementId: string; customerName: string; since: Date; settled: boolean };

/**
 * Rentals whose equipment all came back before the agreed ending (B2-19): the ones still waiting for the owner's
 * choice, plus the ones his standard choices settled in the last few days (so he can still change them).
 */
export async function returnedEarlyRows(take: number, now: Date): Promise<ReturnedEarlyRow[]> {
  const waiting = await prisma.$queryRaw<Array<{ id: string; since: Date }>>`
    SELECT a."id", MAX(e."closedAt") AS "since"
    FROM "RentalAgreement" a
    JOIN "ApplianceCustodyEpisode" e ON e."agreementId" = a."id"
    WHERE a."status" = 'ACTIVE'
      AND (a."endDate" IS NULL OR a."endDate" > ${utc(now)}::timestamp)
      AND (a."terminationEffectiveOn" IS NULL OR a."terminationEffectiveOn" > ${utc(now)}::timestamp)
      AND NOT EXISTS (SELECT 1 FROM "ApplianceCustodyEpisode" o WHERE o."agreementId" = a."id" AND o."closedAt" IS NULL)
      AND NOT EXISTS (SELECT 1 FROM "EarlyReturnResolution" r WHERE r."agreementId" = a."id")
      AND NOT EXISTS (SELECT 1 FROM "RentalAgreement" n WHERE n."renewedFromAgreementId" = a."id" AND n."status" = 'SCHEDULED')
    GROUP BY a."id"
    ORDER BY MAX(e."closedAt") ASC, a."id" ASC
    LIMIT ${take}
  `;
  const settledRows = await prisma.earlyReturnResolution.findMany({
    where: {
      appliedBy: "DEFAULTS",
      createdAt: { gte: addDays(now, -EARLY_RETURN_DEFAULTS_REVIEW_DAYS) },
      refundedCents: 0,
      refundByHandCents: 0,
      creditId: null,
    },
    select: { agreementId: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
  });
  const ids = [...new Set([...waiting.map((w) => w.id), ...settledRows.map((r) => r.agreementId)])];
  if (ids.length === 0) return [];
  const agreements = await prisma.rentalAgreement.findMany({
    where: { id: { in: ids } },
    select: { id: true, customer: { select: { user: { select: { name: true, email: true } } } } },
  });
  const names = new Map(agreements.map((a) => [a.id, customerDisplayName(a.customer)]));
  return [
    ...waiting.map((w) => ({ agreementId: w.id, customerName: names.get(w.id) ?? "A customer", since: new Date(w.since), settled: false })),
    ...settledRows.map((r) => ({ agreementId: r.agreementId, customerName: names.get(r.agreementId) ?? "A customer", since: r.createdAt, settled: true })),
  ].slice(0, take);
}

const empty = <T,>(): Promise<Capped<T>> => Promise.resolve({ rows: [], total: 0 });

// AR-0b: the past-due, overdue-visit and unreviewed-request To do reads, shared by Today (getExceptionOverview) and
// the customer record's customer-scoped next steps (src/domains/customers/record.ts), so both build the same items.
export function pastDueTodoWhere(now: Date) {
  return {
    // BILL-1: no chasing while a bank payment is being confirmed (the customer already paid).
    ...notInFlightWhere,
    OR: [
      { status: { in: ["DELINQUENT", "PARTIALLY_PAID"] } },
      { status: "OPEN", dueDate: { lt: now } },
    ],
  } satisfies Prisma.InvoiceWhereInput;
}
export const PAST_DUE_TODO_SELECT = {
  id: true,
  customerId: true,
  status: true,
  dueDate: true,
  updatedAt: true,
  amountDueCents: true,
  amountPaidCents: true,
  payments: {
    where: { status: "failed" },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  customer: { select: { phone: true, user: { select: { name: true, email: true } } } },
} satisfies Prisma.InvoiceSelect;
export const PAST_DUE_TODO_ORDER = [
  { dueDate: "asc" },
  { updatedAt: "asc" },
  { id: "asc" },
] satisfies Prisma.InvoiceOrderByWithRelationInput[];
export function pastDueTodoItem(inv: Prisma.InvoiceGetPayload<{ select: typeof PAST_DUE_TODO_SELECT }>): ExceptionItem {
  return {
    ...pastDueInvoiceException({
      id: inv.id,
      customerId: inv.customerId,
      customerName: customerDisplayName(inv.customer),
      status: inv.status,
      dueDate: inv.dueDate,
      // Auto-charge invoices have no due date; use the actual failed
      // attempt rather than silently dropping them from To do.
      attentionAt: inv.payments[0]?.createdAt ?? inv.updatedAt,
      amountDueCents: inv.amountDueCents,
      amountPaidCents: inv.amountPaidCents,
    }),
    contact: customerContact(inv.customer),
  };
}
export function overdueJobTodoWhere(now: Date) {
  return { status: "SCHEDULED", scheduledAt: { lt: now } } satisfies Prisma.JobWhereInput;
}
export const OVERDUE_JOB_TODO_SELECT = {
  id: true,
  type: true,
  scheduledAt: true,
  customer: { select: { user: { select: { name: true, email: true } } } },
} satisfies Prisma.JobSelect;
export function overdueJobTodoItems(rows: Prisma.JobGetPayload<{ select: typeof OVERDUE_JOB_TODO_SELECT }>[]): ExceptionItem[] {
  return rows
    .filter((j): j is typeof j & { scheduledAt: Date } => j.scheduledAt !== null)
    .map((j) =>
      overdueJobException({
        id: j.id,
        type: j.type,
        scheduledAt: j.scheduledAt,
        customerName: j.customer ? customerDisplayName(j.customer) : null,
      }),
    );
}
export function unreviewedRequestTodoWhere(now: Date) {
  return {
    status: "SUBMITTED",
    openedAt: { lt: addDays(now, -UNREVIEWED_MAINTENANCE_REQUEST_DAYS) },
  } satisfies Prisma.MaintenanceRequestWhereInput;
}
export const UNREVIEWED_REQUEST_TODO_SELECT = {
  id: true,
  openedAt: true,
  problem: true,
  customer: { select: { user: { select: { name: true, email: true } } } },
} satisfies Prisma.MaintenanceRequestSelect;
export function unreviewedRequestTodoItems(
  rows: Prisma.MaintenanceRequestGetPayload<{ select: typeof UNREVIEWED_REQUEST_TODO_SELECT }>[],
): ExceptionItem[] {
  return rows.map((r) =>
    unreviewedMaintenanceRequestException({
      id: r.id,
      openedAt: r.openedAt,
      customerName: customerDisplayName(r.customer),
      problem: r.problem,
    }),
  );
}

// A timestamp-without-time-zone column holds UTC. Passing the instant as text and casting it keeps the
// comparison in UTC whatever the database session's time zone is.
const utc = (date: Date) => date.toISOString();

/**
 * Everything currently needing Chris's attention — the "Needs your
 * attention" section of /desk/today. Each category here reuses a query
 * that (mostly) already existed elsewhere (the dashboard's
 * staleReservationCount, the revenue dashboard's pastDueInvoices) — this
 * just gathers them into one flat, sortable, linkable list instead of
 * leaving them as separate counts on separate pages.
 *
 * R17: every category is bounded (see EXCEPTION_CATEGORY_CAP) and ordered in the database, so this
 * never reads a whole historical table. The overall order is unchanged: high severity first, then
 * longest waiting.
 *
 * uninspectedReturnException's "how long" (Appliance.updatedAt) is an
 * approximation, not exact: updatedAt changes on any edit to that
 * appliance row, not only a status change. Good enough to flag "this has
 * been sitting a while," same spirit as this app's other documented
 * approximations (see computeMrrTrend's own doc comment) — not worth a
 * dedicated timestamp column for a secondary sort key.
 */
export async function getExceptionOverview(): Promise<ExceptionOverview> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const role = (session.user as { role?: string }).role ?? "";
  const canViewFinance = ["OWNER", "ADMIN"].includes(role);
  const now = new Date();
  const customerSelect = { customer: { select: { user: { select: { name: true, email: true } } } } } as const;

  const billingBlockedWhere = { billingBlockedReason: { not: null } } satisfies Prisma.RentalAgreementWhereInput;
  const taxBlockedInvoiceWhere = {
    status: "DRAFT",
    stripeInvoiceId: null,
    agreementId: { not: null },
    lineItems: { some: { kind: { in: ["LATE_RETURN", "EARLY_TERMINATION_FEE", "RENTAL"] } } },
  } satisfies Prisma.InvoiceWhereInput;
  const stripeTaxReviewAuditWhere = {
    action: {
      in: ["billing.stripe_tax_mismatch", "billing.stripe_tax_unverified"],
    },
    entityType: "Invoice",
    entityId: { not: null },
  } satisfies Prisma.AuditLogWhereInput;
  const exemptionExpiryWindow = taxExemptionExpiryWindow(now);
  const taxExemptionExpiryWhere = {
    revokedAt: null,
    expiresOn: {
      gte: exemptionExpiryWindow.from,
      lt: exemptionExpiryWindow.throughExclusive,
    },
  } satisfies Prisma.CustomerTaxExemptionWhereInput;
  const taxAddressChangeWhere = {
    isCurrent: true,
    status: "NEEDS_REVIEW",
    serviceAddressId: { not: null },
    reviewNote: TAX_ADDRESS_CHANGE_REVIEW_NOTE,
  } satisfies Prisma.AddressTaxLocationWhereInput;
  const taxSourceChangedWhere = {
    active: true,
    lastChangedAt: { not: null },
    reviewedAt: null,
  } satisfies Prisma.OfficialSourceWatchWhereInput;
  const taxSourceUnreachableWhere = {
    active: true,
    consecutiveFailures: { gte: 3 },
  } satisfies Prisma.OfficialSourceWatchWhereInput;
  const staleWhere = {
    status: { in: ["DRAFT", "AWAITING_SIGNATURE"] },
    reservationExpiresAt: { lt: now },
  } satisfies Prisma.RentalAgreementWhereInput;
  const pastDueWhere = pastDueTodoWhere(now);
  const overdueJobWhere = overdueJobTodoWhere(now);
  const unreviewedWhere = unreviewedRequestTodoWhere(now);
  const oldSetWhere = {
    applianceType: { slug: OLD_SET_TYPE_SLUG, isActive: false },
    archivedAt: null,
    status: { not: "RETIRED" },
  } satisfies Prisma.ApplianceWhereInput;
  const uninspectedWhere = {
    status: "AWAITING_INSPECTION",
    updatedAt: { lt: addDays(now, -UNINSPECTED_RETURN_DAYS) },
  } satisfies Prisma.ApplianceWhereInput;
  const missingCostWhere = {
    type: "MAINTENANCE_VISIT",
    status: "COMPLETED",
    partsCostCents: null,
    laborCostCents: null,
    completedAt: { not: null },
  } satisfies Prisma.JobWhereInput;
  const renewalWhere = {
    status: "SCHEDULED",
    startDate: { lt: addDays(now, -RENEWAL_START_GRACE_DAYS) },
  } satisfies Prisma.RentalAgreementWhereInput;
  const endingWhere = { status: "ACTIVE", terminationEffectiveOn: { lt: now } } satisfies Prisma.RentalAgreementWhereInput;
  // Waiting to be sent. (A send interrupted mid-way is retried by the nightly job, or becomes UNCERTAIN.)
  const noticeWhere = { status: "PENDING" } satisfies Prisma.CustomerNoticeWhereInput;
  const noticeProblemWhere = (status: "MISSED" | "UNCERTAIN" | "FAILED") =>
    ({ status }) satisfies Prisma.CustomerNoticeWhereInput;
  const cappedNotices = (status: "MISSED" | "UNCERTAIN" | "FAILED") =>
    capped(
      (take) => prisma.customerNotice.findMany({
        where: noticeProblemWhere(status),
        select: { id: true, kind: true, createdAt: true, ...customerSelect },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take,
      }),
      () => prisma.customerNotice.count({ where: noticeProblemWhere(status) }),
    );
  const undeliveredWhere = { deliveredOn: null, removedAt: null } satisfies Prisma.PendingDeliveryWhereInput;
  // Operational: an appliance that says it is with a customer but has no custody record.
  const pendingReductionWhere = {
    idempotencyKey: { startsWith: LINE_REDUCE_KEY_PREFIX },
    status: { not: "SUCCEEDED" },
  } satisfies Prisma.ProviderOperationWhereInput;
  const custodyGapWhere = {
    status: { in: ["RENTED", "AWAITING_PICKUP"] },
    archivedAt: null,
    custodyEpisodes: { none: { closedAt: null } },
  } satisfies Prisma.ApplianceWhereInput;

  const maintenanceCutoff = utc(addDays(now, -APPLIANCE_MAINTENANCE_DUE_DAYS));

  const [
    billingBlockedAgreements,
    taxBlockedInvoices,
    stripeTaxReviewAudits,
    taxExemptionsExpiring,
    taxAddressChanges,
    taxSourceChanges,
    taxSourceFailures,
    officialRateAttention,
    rdfSwitchesPending,
    ruleChangeAttention,
    staleReservations,
    pastDueInvoices,
    overdueJobs,
    unreviewedRequests,
    uninspectedAppliances,
    missingRepairCostJobs,
    termExpired,
    maintenanceDue,
    stuckRenewals,
    stuckEndings,
    waitingNotices,
    missedNotices,
    uncertainNotices,
    failedNotices,
    itemsNotDelivered,
    returnedEarly,
    custodyGaps,
    pendingLineReductions,
    oldSetAppliances,
    outOfServicePeriods,
  ] = await Promise.all([
    canViewFinance
      ? capped(
          (take) => prisma.rentalAgreement.findMany({
            where: billingBlockedWhere,
            select: { id: true, billingBlockedReason: true, updatedAt: true, ...customerSelect },
            orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
            take,
          }),
          () => prisma.rentalAgreement.count({ where: billingBlockedWhere }),
        )
      : empty<never>(),
    canViewFinance
      ? capped(
          (take) => prisma.invoice.findMany({
            where: taxBlockedInvoiceWhere,
            select: {
              id: true,
              invoiceNumber: true,
              customerId: true,
              createdAt: true,
              customer: { select: { user: { select: { name: true, email: true } } } },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take,
          }),
          () => prisma.invoice.count({ where: taxBlockedInvoiceWhere }),
        )
      : empty<never>(),
    canViewFinance
      ? capped(
          (take) => prisma.auditLog.findMany({
            where: stripeTaxReviewAuditWhere,
            select: {
              action: true,
              entityId: true,
              newValue: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take,
          }),
          () => prisma.auditLog.count({ where: stripeTaxReviewAuditWhere }),
        )
      : empty<never>(),
    canViewFinance
      ? capped(
          (take) =>
            prisma.customerTaxExemption.findMany({
              where: taxExemptionExpiryWhere,
              select: {
                customerId: true,
                expiresOn: true,
                customer: {
                  select: {
                    user: { select: { name: true, email: true } },
                  },
                },
              },
              orderBy: [{ expiresOn: "asc" }, { id: "asc" }],
              take,
            }),
          () =>
            prisma.customerTaxExemption.count({
              where: taxExemptionExpiryWhere,
            }),
        )
      : empty<never>(),
    canViewFinance
      ? capped(
          (take) =>
            prisma.addressTaxLocation.findMany({
              where: taxAddressChangeWhere,
              select: {
                lookedUpAt: true,
                serviceAddress: {
                  select: {
                    line1: true,
                    city: true,
                    customerId: true,
                    customer: {
                      select: {
                        user: { select: { name: true, email: true } },
                      },
                    },
                  },
                },
              },
              orderBy: [{ lookedUpAt: "asc" }, { id: "asc" }],
              take,
            }),
          () =>
            prisma.addressTaxLocation.count({ where: taxAddressChangeWhere }),
        )
      : empty<never>(),
    canViewFinance
      ? capped(
          (take) =>
            prisma.officialSourceWatch.findMany({
              where: taxSourceChangedWhere,
              select: {
                id: true,
                label: true,
                url: true,
                lastHash: true,
                lastExcerpt: true,
                lastChangedAt: true,
              },
              orderBy: [{ lastChangedAt: "asc" }, { id: "asc" }],
              take,
            }),
          () =>
            prisma.officialSourceWatch.count({ where: taxSourceChangedWhere }),
        )
      : empty<never>(),
    canViewFinance
      ? capped(
          (take) =>
            prisma.officialSourceWatch.findMany({
              where: taxSourceUnreachableWhere,
              select: {
                id: true,
                label: true,
                url: true,
                lastCheckedAt: true,
              },
              orderBy: [{ lastCheckedAt: "asc" }, { id: "asc" }],
              take,
            }),
          () =>
            prisma.officialSourceWatch.count({
              where: taxSourceUnreachableWhere,
            }),
        )
      : empty<never>(),
    canViewFinance ? listOfficialRateAttention(now) : Promise.resolve([]),
    canViewFinance ? listPendingRdfSwitches(now) : Promise.resolve([]),
    canViewFinance ? listRuleChangeAttention(now) : Promise.resolve([]),
    capped(
      (take) => prisma.rentalAgreement.findMany({
        where: staleWhere,
        select: { id: true, reservationExpiresAt: true, ...customerSelect },
        orderBy: [{ reservationExpiresAt: "asc" }, { id: "asc" }],
        take,
      }),
      () => prisma.rentalAgreement.count({ where: staleWhere }),
    ),
    canViewFinance
      ? capped(
          (take) => prisma.invoice.findMany({
            where: pastDueWhere,
            select: PAST_DUE_TODO_SELECT,
            orderBy: PAST_DUE_TODO_ORDER,
            take,
          }),
          () => prisma.invoice.count({ where: pastDueWhere }),
        )
      : empty<never>(),
    capped(
      (take) => prisma.job.findMany({
        where: overdueJobWhere,
        select: OVERDUE_JOB_TODO_SELECT,
        orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
        take,
      }),
      () => prisma.job.count({ where: overdueJobWhere }),
    ),
    capped(
      (take) => prisma.maintenanceRequest.findMany({
        where: unreviewedWhere,
        select: UNREVIEWED_REQUEST_TODO_SELECT,
        orderBy: [{ openedAt: "asc" }, { id: "asc" }],
        take,
      }),
      () => prisma.maintenanceRequest.count({ where: unreviewedWhere }),
    ),
    capped(
      (take) => prisma.appliance.findMany({
        where: uninspectedWhere,
        select: { id: true, assetNumber: true, updatedAt: true, applianceType: { select: { name: true } } },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take,
      }),
      () => prisma.appliance.count({ where: uninspectedWhere }),
    ),
    canViewFinance
      ? capped(
          (take) => prisma.job.findMany({
            where: missingCostWhere,
            select: {
              id: true,
              completedAt: true,
              appliances: {
                take: 1,
                orderBy: [{ id: "asc" }],
                select: { appliance: { select: { assetNumber: true, applianceType: { select: { name: true } } } } },
              },
            },
            orderBy: [{ completedAt: "asc" }, { id: "asc" }],
            take,
          }),
          () => prisma.job.count({ where: missingCostWhere }),
        )
      : empty<never>(),
    termExpiredAgreements(now),
    maintenanceDueAppliances(maintenanceCutoff),
    capped(
      (take) => prisma.rentalAgreement.findMany({
        where: renewalWhere,
        select: { id: true, startDate: true, ...customerSelect },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
        take,
      }),
      () => prisma.rentalAgreement.count({ where: renewalWhere }),
    ),
    canViewFinance
      ? capped(
          (take) => prisma.rentalAgreement.findMany({
            where: endingWhere,
            select: { id: true, terminationEffectiveOn: true, paidInFullInAdvance: true, ...customerSelect },
            orderBy: [{ terminationEffectiveOn: "asc" }, { id: "asc" }],
            take,
          }),
          () => prisma.rentalAgreement.count({ where: endingWhere }),
        )
      : empty<never>(),
    canViewFinance
      ? capped(
          (take) => prisma.customerNotice.findMany({
            where: noticeWhere,
            select: { id: true, kind: true, createdAt: true, ...customerSelect },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take,
          }),
          () => prisma.customerNotice.count({ where: noticeWhere }),
        )
      : empty<never>(),
    canViewFinance ? cappedNotices("MISSED") : empty<never>(),
    canViewFinance ? cappedNotices("UNCERTAIN") : empty<never>(),
    canViewFinance ? cappedNotices("FAILED") : empty<never>(),
    // Operational, not money: every role sees an item that still has to be delivered.
    capped(
      (take) => prisma.pendingDelivery.findMany({
        where: undeliveredWhere,
        select: {
          id: true,
          originalJobId: true,
          originalDeliveryDate: true,
          appliance: { select: { assetNumber: true, applianceType: { select: { name: true } } } },
          agreement: { select: { customer: { select: { user: { select: { name: true, email: true } } } } } },
        },
        orderBy: [{ originalDeliveryDate: "asc" }, { id: "asc" }],
        take,
      }),
      () => prisma.pendingDelivery.count({ where: undeliveredWhere }),
    ),
    // Money decision (refund, credit, fee): owners and admins.
    canViewFinance
      ? capped(
          (take) => returnedEarlyRows(take, now),
          async () => (await returnedEarlyRows(5000, now)).length,
        )
      : empty<ReturnedEarlyRow>(),
    capped(
      (take) => prisma.appliance.findMany({
        where: custodyGapWhere,
        select: { id: true, assetNumber: true, updatedAt: true, applianceType: { select: { name: true } } },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take,
      }),
      () => prisma.appliance.count({ where: custodyGapWhere }),
    ),
    // Money: a cancelled item whose recorded Stripe change is not finished yet (same rule as the job page).
    canViewFinance
      ? capped(
          (take) => prisma.providerOperation.findMany({
            where: pendingReductionWhere,
            select: { idempotencyKey: true, requestedAt: true },
            orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
            take,
          }),
          () => prisma.providerOperation.count({ where: pendingReductionWhere }),
        )
      : empty<never>(),
    // Inventory: appliances still recorded as one old "Washer + Dryer Set" (W-16B); owner/admin split them.
    canViewFinance
      ? capped(
          (take) => prisma.appliance.findMany({
            where: oldSetWhere,
            select: { id: true, assetNumber: true, createdAt: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take,
          }),
          () => prisma.appliance.count({ where: oldSetWhere }),
        )
      : empty<never>(),
    // Operations + money: machines out for repair with no replacement yet (W-21A). Owner/admin decide.
    canViewFinance
      ? capped(
          (take) => prisma.outOfServicePeriod.findMany({
            where: { endedOn: null },
            select: {
              id: true,
              startedOn: true,
              applianceId: true,
              appliance: { select: { assetNumber: true, applianceType: { select: { name: true } } } },
              agreement: { select: customerSelect },
            },
            orderBy: [{ startedOn: "asc" }, { id: "asc" }],
            take,
          }),
          () => prisma.outOfServicePeriod.count({ where: { endedOn: null } }),
        )
      : empty<never>(),
  ]);
  const outOfServiceEscalationDays = outOfServicePeriods.rows.length
    ? ((await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { outOfServiceEscalationDays: true } }))
        ?.outOfServiceEscalationDays ?? 3)
    : 3;
  const oldSetContents = oldSetAppliances.rows.length
    ? packageContents(
        (
          await prisma.rentalPackageComponent.findMany({
            where: { package: { slug: OLD_SET_TYPE_SLUG } },
            select: { quantity: true, applianceType: { select: { name: true, sortOrder: true } } },
          })
        )
          .sort((a, b) => a.applianceType.sortOrder - b.applianceType.sortOrder)
          .map((c) => ({ quantity: c.quantity, name: c.applianceType.name })),
      ) || "a washer and a dryer"
    : "";
  const taxProblemAudits = taxBlockedInvoices.rows.length
    ? await prisma.auditLog.findMany({
        where: {
          action: "billing.invoice_tax_blocked",
          entityType: "Invoice",
          entityId: { in: taxBlockedInvoices.rows.map((invoice) => invoice.id) },
        },
        select: { entityId: true, newValue: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    : [];
  const taxProblemsByInvoice = new Map<string, { problems: string[]; since: Date }>();
  for (const audit of taxProblemAudits) {
    if (!audit.entityId || taxProblemsByInvoice.has(audit.entityId)) continue;
    const value = audit.newValue as { problems?: unknown } | null;
    const problems = Array.isArray(value?.problems)
      ? value.problems.filter((problem): problem is string => typeof problem === "string")
      : [];
    taxProblemsByInvoice.set(audit.entityId, { problems, since: audit.createdAt });
  }

  const stripeTaxReviewInvoiceIds = [
    ...new Set(
      stripeTaxReviewAudits.rows.flatMap((audit) =>
        typeof audit.entityId === "string" ? [audit.entityId] : [],
      ),
    ),
  ];
  const stripeTaxReviewInvoices = stripeTaxReviewInvoiceIds.length
    ? await prisma.invoice.findMany({
        where: { id: { in: stripeTaxReviewInvoiceIds } },
        select: {
          id: true,
          invoiceNumber: true,
          customerId: true,
          customer: { select: { user: { select: { name: true, email: true } } } },
        },
      })
    : [];
  const stripeTaxReviewInvoiceById = new Map(
    stripeTaxReviewInvoices.map((invoice) => [invoice.id, invoice]),
  );

  const pendingItems = pendingLineReductions.rows.length
    ? await prisma.pendingDelivery.findMany({
        where: {
          id: { in: pendingLineReductions.rows.flatMap((op) => parseLineReduceKey(op.idempotencyKey) ?? []) },
          removedAt: { not: null },
        },
        select: {
          id: true,
          originalJobId: true,
          appliance: { select: { assetNumber: true, applianceType: { select: { name: true } } } },
          agreement: { select: { customer: { select: { user: { select: { name: true, email: true } } } } } },
        },
      })
    : [];
  const pendingItemById = new Map(pendingItems.map((p) => [p.id, p]));

  const items: ExceptionItem[] = [
    ...pendingLineReductions.rows.flatMap((op) => {
      const pd = pendingItemById.get(parseLineReduceKey(op.idempotencyKey) ?? "");
      return pd
        ? [subscriptionUpdatePendingException({
            originalJobId: pd.originalJobId,
            itemLabel: `${pd.appliance.applianceType.name} #${pd.appliance.assetNumber}`,
            customerName: customerDisplayName(pd.agreement.customer),
            since: op.requestedAt,
          })]
        : [];
    }),
    ...custodyGaps.rows.map((a) =>
      custodyUnknownException({ id: a.id,
        // Inconsistent legacy/isolated fixture data must produce an exception,
        // not make the entire operator exception dashboard fail.
        label: `${a.applianceType?.name ?? "Unknown appliance"} #${a.assetNumber}`,
        since: a.updatedAt }),
    ),
    ...itemsNotDelivered.rows.map((p) =>
      itemNotDeliveredException({
        originalJobId: p.originalJobId,
        itemLabel: `${p.appliance.applianceType.name} #${p.appliance.assetNumber}`,
        originalDeliveryDate: p.originalDeliveryDate,
        customerName: customerDisplayName(p.agreement.customer),
      }),
    ),
    ...returnedEarly.rows.map((r) => returnedEarlyException(r)),
    ...waitingNotices.rows.map((n) =>
      noticeWaitingException({ id: n.id, createdAt: n.createdAt, kind: n.kind, customerName: customerDisplayName(n.customer) }),
    ),
    ...missedNotices.rows.map((n) =>
      noticeProblemException("MISSED", { id: n.id, createdAt: n.createdAt, kind: n.kind, customerName: customerDisplayName(n.customer) }),
    ),
    ...uncertainNotices.rows.map((n) =>
      noticeProblemException("UNCERTAIN", { id: n.id, createdAt: n.createdAt, kind: n.kind, customerName: customerDisplayName(n.customer) }),
    ),
    ...failedNotices.rows.map((n) =>
      noticeProblemException("FAILED", { id: n.id, createdAt: n.createdAt, kind: n.kind, customerName: customerDisplayName(n.customer) }),
    ),
    ...stuckEndings.rows
      .filter((a) => a.terminationEffectiveOn !== null)
      .map((a) =>
        earlyEndingNotDoneException({
          id: a.id,
          terminationEffectiveOn: a.terminationEffectiveOn as Date,
          prepaid: a.paidInFullInAdvance,
          customerName: customerDisplayName(a.customer),
        }),
      ),
    ...stuckRenewals.rows
      .filter((a): a is typeof a & { startDate: Date } => a.startDate !== null)
      .map((a) =>
        renewalNotStartedException({
          id: a.id,
          startDate: a.startDate,
          customerName: customerDisplayName(a.customer),
        }),
      ),
    ...stripeTaxReviewAudits.rows.flatMap((audit) => {
      if (!audit.entityId) return [];
      const invoice = stripeTaxReviewInvoiceById.get(audit.entityId);
      if (!invoice) return [];

      if (audit.action === "billing.stripe_tax_unverified") {
        const value = audit.newValue as { problems?: unknown } | null;
        const problems = Array.isArray(value?.problems)
          ? value.problems.filter(
              (problem): problem is string => typeof problem === "string",
            )
          : [];
        return [
          stripeTaxUnverifiedException({
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            customerId: invoice.customerId,
            customerName: customerDisplayName(invoice.customer),
            since: audit.createdAt,
            problems,
          }),
        ];
      }

      const value = audit.newValue as {
        stripeTaxCents?: unknown;
        engineTaxCents?: unknown;
      } | null;
      if (
        typeof value?.stripeTaxCents !== "number" ||
        typeof value.engineTaxCents !== "number"
      ) {
        return [];
      }
      return [
        stripeTaxMismatchException({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerId: invoice.customerId,
          customerName: customerDisplayName(invoice.customer),
          since: audit.createdAt,
          stripeTaxCents: value.stripeTaxCents,
          engineTaxCents: value.engineTaxCents,
        }),
      ];
    }),
    ...(canViewFinance && businessDateKey(now).endsWith("-05-15")
      ? [
          taxRateReviewReminderException({
            nextEffectiveDateLabel: "July 1",
            since: businessDayBounds(now).start,
          }),
        ]
      : canViewFinance && businessDateKey(now).endsWith("-11-15")
        ? [
            taxRateReviewReminderException({
              nextEffectiveDateLabel: "January 1",
              since: businessDayBounds(now).start,
            }),
          ]
        : []),
    ...taxAddressChanges.rows.flatMap((location) => {
      const address = location.serviceAddress;
      if (!address) return [];
      return [
        taxAddressChangedException({
          customerId: address.customerId,
          customerName: customerDisplayName(address.customer),
          addressLabel: `${address.line1}, ${address.city}`,
          since: location.lookedUpAt,
        }),
      ];
    }),
    ...taxSourceChanges.rows
      .filter(
        (
          watch,
        ): watch is typeof watch & {
          lastChangedAt: Date;
          lastHash: string;
        } => watch.lastChangedAt !== null && watch.lastHash !== null,
      )
      .map((watch) =>
        taxSourceChangedException({
          id: watch.id,
          version: `${watch.lastHash}:${watch.lastChangedAt.getTime()}`,
          label: watch.label,
          excerpt: watch.lastExcerpt,
          url: watch.url,
          since: watch.lastChangedAt,
        }),
      ),
    ...taxSourceFailures.rows.map((watch) =>
      taxSourceUnreachableException({
        label: watch.label,
        url: watch.url,
        since: watch.lastCheckedAt ?? now,
      }),
    ),
    ...officialRateAttention.map((item) =>
      item.kind === "SCHEDULED"
        ? officialRateScheduledException({
            rateVersionId: item.rateVersionId,
            jurisdictionName: item.jurisdictionName,
            oldRateMilliPercent: item.oldRateMilliPercent,
            newRateMilliPercent: item.newRateMilliPercent,
            effectiveFrom: item.effectiveFrom,
            since: item.createdAt,
            undoAllowed: item.undoAllowed,
          })
        : officialRateReviewException({
            observationId: item.observationId,
            jurisdictionName: item.jurisdictionName,
            oldRateMilliPercent: item.oldRateMilliPercent,
            newRateMilliPercent: item.newRateMilliPercent,
            effectiveFrom: item.effectiveFrom,
            reasons: item.reasons,
            since: item.observedAt,
          }),
    ),
    ...ruleChangeAttention.map((item) =>
      ruleChangeReviewException({
        observationId: item.observationId,
        ruleTitle: ruleDef(item.ruleKey).title,
        describedValue: ruleDef(item.ruleKey).describe(item.value as never),
        ruleKey: item.ruleKey,
        effectiveFrom: item.effectiveFrom,
        evidence: item.evidence,
        watchUrl: item.watchUrl,
        readOnTwoDays: item.readOnTwoDays,
        plausible: item.plausible,
        startPassed: item.startPassed,
        since: item.since,
        now,
      }),
    ),
    ...taxExemptionsExpiring.rows
      .filter(
        (exemption): exemption is typeof exemption & { expiresOn: Date } =>
          exemption.expiresOn !== null,
      )
      .map((exemption) =>
        taxExemptionExpiryException({
          customerId: exemption.customerId,
          customerName: customerDisplayName(exemption.customer),
          expiresOn: exemption.expiresOn,
          warningSince: taxExemptionWarningSince(exemption.expiresOn),
        }),
      ),
    ...taxBlockedInvoices.rows.map((invoice) => {
      const taxProblem = taxProblemsByInvoice.get(invoice.id);
      return invoiceTaxBlockedException({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        customerName: customerDisplayName(invoice.customer),
        since: taxProblem?.since ?? invoice.createdAt,
        problems: taxProblem?.problems ?? [],
      });
    }),
    ...billingBlockedAgreements.rows
      .filter((a): a is typeof a & { billingBlockedReason: string } => a.billingBlockedReason !== null)
      .map((a) =>
        billingBlockedException({
          id: a.id,
          billingBlockedReason: a.billingBlockedReason!,
          updatedAt: a.updatedAt,
          customerName: customerDisplayName(a.customer),
        }),
      ),
    ...staleReservations.rows
      .filter((a): a is typeof a & { reservationExpiresAt: Date } => a.reservationExpiresAt !== null)
      .map((a) =>
        staleReservationException({
          id: a.id,
          reservationExpiresAt: a.reservationExpiresAt,
          customerName: customerDisplayName(a.customer),
        }),
      ),
    ...pastDueInvoices.rows.map(pastDueTodoItem),
    ...overdueJobTodoItems(overdueJobs.rows),
    ...unreviewedRequestTodoItems(unreviewedRequests.rows),
    ...outOfServicePeriods.rows.map((p) =>
      outOfServiceException({
        applianceId: p.applianceId,
        assetNumber: p.appliance.assetNumber,
        typeName: p.appliance.applianceType.name,
        customerName: customerDisplayName(p.agreement.customer),
        startedOn: p.startedOn,
        daysOut: Math.max(0, businessDaysBetween(p.startedOn, now)) + 1,
        escalationDays: outOfServiceEscalationDays,
      }),
    ),
    ...oldSetAppliances.rows.map((a) =>
      oldSetApplianceException({ id: a.id, assetNumber: a.assetNumber, contents: oldSetContents, createdAt: a.createdAt }),
    ),
    ...uninspectedAppliances.rows.map((a) =>
      uninspectedReturnException({
        id: a.id,
        assetNumber: a.assetNumber,
        applianceTypeName: a.applianceType.name,
        updatedAt: a.updatedAt,
      }),
    ),
    ...missingRepairCostJobs.rows
      .filter((j): j is typeof j & { completedAt: Date } => j.completedAt !== null)
      .map((j) => {
        const first = j.appliances[0]?.appliance;
        return missingRepairCostException({
          id: j.id,
          completedAt: j.completedAt!,
          applianceLabel: first ? `${first.applianceType.name} ${first.assetNumber}` : null,
        });
      }),
    ...termExpired.rows.map((a) =>
      agreementTermExpiredException({
        id: a.id,
        customerName: a.customerName,
        termMonths: a.termMonths,
        termEndDate: a.termEnd,
      }),
    ),
    ...maintenanceDue.rows.map((a) =>
      applianceMaintenanceDueException({
        id: a.id,
        assetNumber: a.assetNumber,
        applianceTypeName: a.typeName,
        sinceDate: a.since,
      }),
    ),
  ];

  const filingAttention = canViewFinance
    ? await listTaxFilingAttention(now, (session.user as { role?: string }).role === "ADMIN")
    : { returns: { rows: [], total: 0 }, licenses: { rows: [], total: 0 }, setupChecks: { rows: [], total: 0 } };

  const paperworkItems =
    (session.user as { role?: string }).role === "OWNER" ? await listPaperworkAttention(now) : [];
  const paperworkAttention: Capped<ExceptionItem> = { rows: paperworkItems, total: paperworkItems.length };
  const rdfRefundAttention = canViewFinance ? await listRdfRefundAttention() : [];
  const useTaxResetAttention = canViewFinance ? await listUseTaxResetAttention(now) : [];
  const expiredExemptionAttention = canViewFinance ? await listExpiredExemptionAttention(now) : [];
  const filingFrequencyAdviceAttention = canViewFinance ? await listFilingFrequencyAdviceAttention(now) : [];
  // TFA-2 §6.3: prepared delivery-fee switches waiting for the owner's
  // approval, rendered as To do items with the approve action.
  const rdfSwitchAttention = rdfSwitchesPending.map((row) => rdfSwitchException({
    switchId: row.id, kind: row.kind, startsOn: row.startsOn,
    basisRetailCents: row.basisRetailCents, since: row.createdAt, now,
  }));

  const amendmentAttention = canViewFinance
    ? await listTaxAmendmentAttention(now)
    : { amendments: { rows: [], total: 0 }, readiness: { rows: [], total: 0 } };

  const acquisitionAttention = canViewFinance ? await listAcquisitionTaxAttention(now) : [];
  const retiredAttention = canViewFinance ? await listRetiredPlanAttention(now) : [];
  const recallAttention = canViewFinance ? await listRecallAttention(now) : [];
  const booksAttention = canViewFinance ? await listBooksAttention(now) : [];
  const booksSetupAttention = session.user.role === "OWNER" ? await listBooksSetupAttention(now) : [];
  const booksMonthReviewAttention = canViewFinance ? await listBooksMonthReviewAttention(now) : [];
  const resaleTaxAttention = (session.user as { role?: string }).role === "OWNER" ? await listResaleTaxAttention(now) : [];
  const approvalAttention = (session.user as { role?: string }).role === "OWNER" ? await listApprovalAttention(now) : [];
  const goalAttention = canViewFinance ? await listGoalAttention(now) : [];
  const signingPaymentAttention = canViewFinance
    ? await listSigningPaymentAttention(EXCEPTION_CATEGORY_CAP)
    : { rows: [], total: 0 };

  const cancellationRefundAttention = canViewFinance ? await listCancellationRefundAttention(EXCEPTION_CATEGORY_CAP) : { rows: [], total: 0 };
  const signedDeliveryAttention = canViewFinance ? await listSignedDeliveryAttention(EXCEPTION_CATEGORY_CAP) : { rows: [], total: 0 };
  const noTurningPoints = { rows: [] as ExceptionItem[], total: 0 };
  const bankPaymentsSlow = canViewFinance ? await listBankPaymentSlow(EXCEPTION_CATEGORY_CAP, now) : noTurningPoints;
  // DEC-2: owner only (the starting values are the owner's to review).
  const startingValues = role === "OWNER" ? await listStartingValuesAttention() : noTurningPoints;
  const paymentDisputes = canViewFinance ? await listDisputeAttention(EXCEPTION_CATEGORY_CAP, now) : noTurningPoints;
  const lateFeeReview = canViewFinance ? await listLateFeeReview(EXCEPTION_CATEGORY_CAP, now) : noTurningPoints;
  const heldPayments = canViewFinance ? await listHeldPaymentAttention(EXCEPTION_CATEGORY_CAP) : noTurningPoints;
  const depositDecisions = canViewFinance ? await listDepositDecisionAttention(EXCEPTION_CATEGORY_CAP, now) : noTurningPoints;
  const newLeadContact = canViewFinance ? await listNewLeadContact(EXCEPTION_CATEGORY_CAP) : noTurningPoints;
  const leadFollowUps = canViewFinance ? await listLeadFollowUps(EXCEPTION_CATEGORY_CAP, now) : noTurningPoints;
  const complianceDue = canViewFinance ? await listComplianceDue(EXCEPTION_CATEGORY_CAP, now) : noTurningPoints;
  const approvedQuotes = canViewFinance ? await listApprovedQuoteToRental(EXCEPTION_CATEGORY_CAP, now) : noTurningPoints;
  const rentalEndingSoon = canViewFinance ? await listRentalEndingSoon(EXCEPTION_CATEGORY_CAP, now) : noTurningPoints;
  const unsignedAgreements = canViewFinance ? await listUnsignedAgreements(EXCEPTION_CATEGORY_CAP, now) : noTurningPoints;
  const pickupUnscheduled = canViewFinance ? await listPickupUnscheduled(EXCEPTION_CATEGORY_CAP) : noTurningPoints;
  const cleaningNeeded = canViewFinance ? await listCleaningNeeded(EXCEPTION_CATEGORY_CAP) : noTurningPoints;
  const visitNeedsAssignment = canViewFinance ? await listVisitNeedsAssignment(EXCEPTION_CATEGORY_CAP, now) : noTurningPoints;
  // MCP-10a: app feedback waiting for the team (owner and admins only).
  const feedbackWaiting = canViewFinance ? await listFeedbackWaiting(EXCEPTION_CATEGORY_CAP) : noTurningPoints;
  const salesTaxItems = items
    .filter((item) => item.category === "SALES_TAX")
    .sort((left, right) => left.since.getTime() - right.since.getTime());
  const cappedSalesTaxItems = salesTaxItems.slice(0, EXCEPTION_CATEGORY_CAP);
  // System diagnostics are separate from customer work; only finance roles see them.
  const systemIssueWhere = { severity: "HIGH" as const,
    status: { in: ["OPEN" as const, "ACKNOWLEDGED" as const] } };
  const systemIssueRows = canViewFinance ? await prisma.systemIssue.findMany({
    where: systemIssueWhere, orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
    take: EXCEPTION_CATEGORY_CAP, select: { summary: true, lastSeenAt: true, kind: true },
  }) : [];
  const systemIssueTotal = canViewFinance
    ? await prisma.systemIssue.count({ where: systemIssueWhere }) : 0;
  const visibleItems = [
    ...systemIssueRows.map((issue) => ({
      category: "SYSTEM_ISSUE" as const, severity: "high" as const,
      title: issue.summary, detail: "System health needs review.",
      href: issue.kind === "TELECOM_CONTACTS_UNRESOLVED" ? "/desk/communications" : issue.kind.startsWith("TELECOM_") ? "/desk/settings/telecom" : "/desk/automations#system-issues", since: issue.lastSeenAt,
    })),
    ...items.filter((item) => item.category !== "SALES_TAX"),
    ...signingPaymentAttention.rows,
    ...cancellationRefundAttention.rows,
    ...signedDeliveryAttention.rows,
    ...heldPayments.rows,
    ...bankPaymentsSlow.rows,
    ...startingValues.rows,
    ...paymentDisputes.rows,
    ...newLeadContact.rows,
    ...leadFollowUps.rows,
    ...complianceDue.rows,
    ...approvedQuotes.rows,
    ...depositDecisions.rows,
    ...rentalEndingSoon.rows,
    ...unsignedAgreements.rows,
    ...pickupUnscheduled.rows,
    ...visitNeedsAssignment.rows,
    ...cleaningNeeded.rows,
    ...feedbackWaiting.rows,
    ...cappedSalesTaxItems,
    ...filingAttention.returns.rows,
    ...filingAttention.licenses.rows,
    ...filingAttention.setupChecks.rows,
    ...paperworkAttention.rows,
    ...rdfRefundAttention,
    ...rdfSwitchAttention,
    ...useTaxResetAttention,
    ...expiredExemptionAttention,
    ...filingFrequencyAdviceAttention,
    ...amendmentAttention.amendments.rows,
    ...amendmentAttention.readiness.rows,
    ...acquisitionAttention,
    ...retiredAttention,
    ...recallAttention,
    ...booksAttention,
    ...booksSetupAttention,
    ...booksMonthReviewAttention,
    ...resaleTaxAttention,
    ...approvalAttention,
    ...goalAttention,
  ];

  const truncated: ExceptionTruncation[] = (
    [
      ["SYSTEM_ISSUE", { rows: systemIssueRows, total: systemIssueTotal }],
      ["BILLING_BLOCKED", billingBlockedAgreements],
      ["SALES_TAX", {
        rows: cappedSalesTaxItems,
        total:
          taxBlockedInvoices.total +
          stripeTaxReviewAudits.total +
          taxExemptionsExpiring.total +
          taxAddressChanges.total +
          taxSourceChanges.total +
          taxSourceFailures.total +
          officialRateAttention.length +
          rdfSwitchesPending.length +
          ruleChangeAttention.length +
          (canViewFinance &&
          (businessDateKey(now).endsWith("-05-15") ||
            businessDateKey(now).endsWith("-11-15"))
            ? 1
            : 0),
      }],
      ["TAX_RETURN_DUE", filingAttention.returns],
      ["TAX_AMENDMENT_DUE", amendmentAttention.amendments],
      ["TAX_FILING_NOT_READY", amendmentAttention.readiness],
      ["TAX_LICENSE_RENEWAL", filingAttention.licenses],
      ["TAX_SETUP_CHECK", filingAttention.setupChecks],
      ["BUSINESS_PAPERWORK", paperworkAttention],
      ["STALE_RESERVATION", staleReservations],
      ["PAST_DUE_INVOICE", pastDueInvoices],
      ["SIGNING_PAYMENT_DUE", signingPaymentAttention],
      ["CANCELLATION_REFUND_DUE", cancellationRefundAttention],
      ["SIGNED_DELIVERY_UNSCHEDULED", signedDeliveryAttention],
      ["BANK_PAYMENT_SLOW", bankPaymentsSlow],
      ["PAYMENT_DISPUTE", paymentDisputes],
      ["LATE_FEE_REVIEW", lateFeeReview],
      ["DECISIONS_STARTING_VALUES", startingValues],
      ["HELD_PAYMENT_DECISION", heldPayments],
      ["DEPOSIT_DECISION", depositDecisions],
      ["NEW_LEAD_CONTACT", newLeadContact],
      ["LEAD_FOLLOW_UP", leadFollowUps],
      ["COMPLIANCE_DUE", complianceDue],
      ["APPROVED_QUOTE", approvedQuotes],
      ["RENTAL_ENDING_SOON", rentalEndingSoon],
      ["UNSIGNED_AGREEMENT", unsignedAgreements],
      ["PICKUP_UNSCHEDULED", pickupUnscheduled],
      ["VISIT_NEEDS_ASSIGNMENT", visitNeedsAssignment],
      ["CLEANING_NEEDED", cleaningNeeded],
      ["FEEDBACK_WAITING", feedbackWaiting],
      ["OVERDUE_JOB", overdueJobs],
      ["UNREVIEWED_MAINTENANCE_REQUEST", unreviewedRequests],
      ["UNINSPECTED_RETURN", uninspectedAppliances],
      ["MISSING_REPAIR_COST", missingRepairCostJobs],
      ["AGREEMENT_TERM_EXPIRED", termExpired],
      ["APPLIANCE_MAINTENANCE_DUE", maintenanceDue],
      ["RENEWAL_NOT_STARTED", stuckRenewals],
      ["EARLY_ENDING_NOT_DONE", stuckEndings],
      ["NOTICE_WAITING", waitingNotices],
      ["NOTICE_MISSED", missedNotices],
      ["NOTICE_UNCERTAIN", uncertainNotices],
      ["NOTICE_FAILED", failedNotices],
      ["ITEM_NOT_DELIVERED", itemsNotDelivered],
      ["RETURNED_EARLY", returnedEarly],
      ["CUSTODY_UNKNOWN", custodyGaps],
      ["SUBSCRIPTION_UPDATE_PENDING", pendingLineReductions],
      ["OLD_SET_APPLIANCE", oldSetAppliances],
      ["OUT_OF_SERVICE", outOfServicePeriods],
    ] as Array<[ExceptionCategory, Capped<unknown>]>
  )
    .filter(([, c]) => c.total > c.rows.length)
    .map(([category, c]) => ({ category, total: c.total, shown: c.rows.length }));

  const { items: activeItems, snoozed } = await markTodoItems(visibleItems, now, canViewFinance);
  return { items: activeItems, snoozed, truncated };
}

/**
 * AR-0b: the end of getExceptionOverview, moved unchanged so the customer record's scoped next steps reuse it: sort, give
 * each item its To do key, action and deadline label, then split off the snoozed ones (with their snooze history).
 */
export async function markTodoItems(
  visibleItems: ExceptionItem[],
  now: Date,
  canViewFinance: boolean,
): Promise<{ items: ExceptionItem[]; snoozed: ExceptionItem[] }> {
  const ordered = sortExceptions(visibleItems).map((item) => ({
    ...item, todoKey: todoKey(item), primaryAction: todoAction(item), dueLabel: todoDeadlineLabel(item.dueOn, now, item.dueDateOnly) ?? undefined,
  }));
  const stored = ordered.length ? await prisma.exceptionSnooze.findMany({
    where: { key: { in: ordered.map((item) => item.todoKey) }, snoozedUntil: { gt: now } },
    include: { actor: { select: { name: true, email: true } } },
  }) : [];
  const byKey = new Map(stored.map((record) => [record.key, record]));
  const auditRows = canViewFinance && ordered.length ? await prisma.auditLog.findMany({
    where: { entityType: "ExceptionSnooze", action: "todo.snoozed",
      entityId: { in: ordered.map((item) => item.todoKey) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200,
    select: { entityId: true, newValue: true, createdAt: true,
      user: { select: { name: true, email: true } } },
  }) : [];
  const historyByKey = new Map<string, NonNullable<ExceptionItem["snoozeHistory"]>>();
  for (const row of auditRows) {
    if (!row.entityId || !row.newValue || typeof row.newValue !== "object" || Array.isArray(row.newValue)) continue;
    const value = row.newValue as Record<string, unknown>;
    if (typeof value.until !== "string" || typeof value.reason !== "string") continue;
    const until = new Date(value.until + "T12:00:00Z");
    if (!Number.isFinite(until.getTime())) continue;
    const history = historyByKey.get(row.entityId) ?? [];
    history.push({ at: row.createdAt, until, reason: value.reason,
      actorName: row.user?.name ?? row.user?.email ?? "Former team member" });
    historyByKey.set(row.entityId, history);
  }
  const marked = ordered.map((item) => {
    const record = byKey.get(item.todoKey);
    const withHistory = { ...item, snoozeHistory: historyByKey.get(item.todoKey) };
    return record ? { ...withHistory, snooze: {
      until: record.snoozedUntil, reason: record.reason,
      actorName: record.actor.name ?? record.actor.email,
    } } : withHistory;
  });
  return { items: marked.filter((item) => !item.snooze),
    snoozed: marked.filter((item) => !!item.snooze) };
}


export async function getExceptions(): Promise<ExceptionItem[]> {
  return (await getExceptionOverview()).items;
}

type TermExpiredRow = { id: string; termMonths: number; termEnd: Date; customerName: string };

/**
 * Active term agreements whose term has ended, oldest first, found in the database. The term end is the
 * agreement's own end date, or its start plus its term in calendar months (a month-end start clamps to
 * the last day of the shorter month, so 31 Jan + 1 month is 28 Feb).
 */
async function termExpiredAgreements(now: Date): Promise<Capped<TermExpiredRow>> {
  const nowText = utc(now);
  const rows = await prisma.$queryRaw<Array<{ id: string; termMonths: number; termEnd: Date }>>`
    SELECT a."id", a."termMonths",
           COALESCE(a."endDate", a."startDate" + (a."termMonths" * INTERVAL '1 month')) AS "termEnd"
    FROM "RentalAgreement" a
    WHERE a."status" = 'ACTIVE' AND a."termMonths" IS NOT NULL AND a."startDate" IS NOT NULL
      AND COALESCE(a."endDate", a."startDate" + (a."termMonths" * INTERVAL '1 month')) < CAST(${nowText} AS timestamp)
    ORDER BY "termEnd" ASC, a."id" ASC
    LIMIT ${EXCEPTION_CATEGORY_CAP}
  `;
  let total = rows.length;
  if (rows.length >= EXCEPTION_CATEGORY_CAP) {
    const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS "n"
      FROM "RentalAgreement" a
      WHERE a."status" = 'ACTIVE' AND a."termMonths" IS NOT NULL AND a."startDate" IS NOT NULL
        AND COALESCE(a."endDate", a."startDate" + (a."termMonths" * INTERVAL '1 month')) < CAST(${nowText} AS timestamp)
    `;
    total = n;
  }
  if (rows.length === 0) return { rows: [], total };
  const names = await prisma.rentalAgreement.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: { id: true, customer: { select: { user: { select: { name: true, email: true } } } } },
  });
  const nameById = new Map(names.map((n) => [n.id, customerDisplayName(n.customer)]));
  return {
    rows: rows.map((r) => ({
      id: r.id,
      termMonths: r.termMonths,
      termEnd: r.termEnd,
      customerName: nameById.get(r.id) ?? "A customer",
    })),
    total,
  };
}

type MaintenanceDueRow = { id: string; assetNumber: string; typeName: string; since: Date };

/**
 * Rented appliances with no completed maintenance visit (or none since they went into service) for
 * longer than APPLIANCE_MAINTENANCE_DUE_DAYS, oldest first. The last visit is found in the database
 * (latest completed maintenance visit, else purchase date, else the day it was added), not by loading
 * every visit of every rented appliance.
 */
async function maintenanceDueAppliances(cutoffText: string): Promise<Capped<MaintenanceDueRow>> {
  const rows = await prisma.$queryRaw<MaintenanceDueRow[]>`
    SELECT a."id", a."assetNumber", t."name" AS "typeName",
           COALESCE(m."lastDone", a."purchaseDate", a."createdAt") AS "since"
    FROM "Appliance" a
    JOIN "ApplianceType" t ON t."id" = a."applianceTypeId"
    LEFT JOIN LATERAL (
      SELECT MAX(j."completedAt") AS "lastDone"
      FROM "JobAppliance" ja
      JOIN "Job" j ON j."id" = ja."jobId"
      WHERE ja."applianceId" = a."id" AND j."type" = 'MAINTENANCE_VISIT' AND j."status" = 'COMPLETED'
    ) m ON TRUE
    WHERE a."status" = 'RENTED' AND a."archivedAt" IS NULL
      AND COALESCE(m."lastDone", a."purchaseDate", a."createdAt") < CAST(${cutoffText} AS timestamp)
    ORDER BY "since" ASC, a."id" ASC
    LIMIT ${EXCEPTION_CATEGORY_CAP}
  `;
  let total = rows.length;
  if (rows.length >= EXCEPTION_CATEGORY_CAP) {
    const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS "n"
      FROM "Appliance" a
      LEFT JOIN LATERAL (
        SELECT MAX(j."completedAt") AS "lastDone"
        FROM "JobAppliance" ja
        JOIN "Job" j ON j."id" = ja."jobId"
        WHERE ja."applianceId" = a."id" AND j."type" = 'MAINTENANCE_VISIT' AND j."status" = 'COMPLETED'
      ) m ON TRUE
      WHERE a."status" = 'RENTED' AND a."archivedAt" IS NULL
        AND COALESCE(m."lastDone", a."purchaseDate", a."createdAt") < CAST(${cutoffText} AS timestamp)
    `;
    total = n;
  }
  return { rows, total };
}

/** Today's schedule — every job (of any status) due today, earliest
 * first. Used by /desk/today alongside getExceptions(). */
export async function getTodaysJobs(now = new Date()) {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const { start: startOfDay, end: startOfTomorrow } = businessDayBounds(now);

  const defaultMinutes = await readDefaultJobMinutes(prisma);
  const jobs = await prisma.job.findMany({
    where: { scheduledAt: { gte: startOfDay, lt: startOfTomorrow } },
    select: {
      id: true, type: true, status: true, scheduledAt: true, durationMinutes: true,
      customer: { select: { user: { select: { name: true, email: true } } } },
      serviceAddress: { select: { line1: true, city: true } },
    },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
  });
  // Each visit's own recorded length, else the business default (Settings → job scheduling).
  return jobs.map((job) => ({ ...job, durationMinutes: job.durationMinutes ?? defaultMinutes }));
}
