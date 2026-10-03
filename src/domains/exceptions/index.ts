import { businessDayBounds } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import {
  APPLIANCE_MAINTENANCE_DUE_DAYS,
  UNINSPECTED_RETURN_DAYS,
  UNREVIEWED_MAINTENANCE_REQUEST_DAYS,
  agreementTermExpiredException,
  applianceMaintenanceDueException,
  billingBlockedException,
  earlyEndingNotDoneException,
  missingRepairCostException,
  overdueJobException,
  pastDueInvoiceException,
  renewalNotStartedException,
  RENEWAL_START_GRACE_DAYS,
  sortExceptions,
  staleReservationException,
  uninspectedReturnException,
  unreviewedMaintenanceRequestException,
  type ExceptionItem,
} from "./rules";

export type { ExceptionItem, ExceptionCategory, ExceptionSeverity } from "./rules";

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function customerDisplayName(customer: { user: { name: string | null; email: string } }): string {
  return customer.user.name ?? customer.user.email;
}

/**
 * Everything currently needing Chris's attention — the "Needs your
 * attention" section of /desk/today. Each category here reuses a query
 * that (mostly) already existed elsewhere (the dashboard's
 * staleReservationCount, the revenue dashboard's pastDueInvoices) — this
 * just gathers them into one flat, sortable, linkable list instead of
 * leaving them as separate counts on separate pages.
 *
 * uninspectedReturnException's "how long" (Appliance.updatedAt) is an
 * approximation, not exact: updatedAt changes on any edit to that
 * appliance row, not only a status change. Good enough to flag "this has
 * been sitting a while," same spirit as this app's other documented
 * approximations (see computeMrrTrend's own doc comment) — not worth a
 * dedicated timestamp column for a secondary sort key.
 */
export async function getExceptions(): Promise<ExceptionItem[]> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const canViewFinance = ["OWNER", "ADMIN"].includes((session.user as { role?: string }).role ?? "");
  const now = new Date();

  const [
    billingBlockedAgreements,
    staleReservations,
    pastDueInvoices,
    overdueJobs,
    unreviewedRequests,
    uninspectedAppliances,
    missingRepairCostJobs,
    activeTermAgreements,
    rentedAppliances,
    stuckRenewals,
    stuckEndings,
  ] = await Promise.all([
    canViewFinance ? prisma.rentalAgreement.findMany({
      where: { billingBlockedReason: { not: null } },
      select: {
        id: true,
        billingBlockedReason: true,
        updatedAt: true,
        customer: { select: { user: { select: { name: true, email: true } } } },
      },
    }) : Promise.resolve([]),
    prisma.rentalAgreement.findMany({
      where: {
        status: { in: ["DRAFT", "AWAITING_SIGNATURE"] },
        reservationExpiresAt: { lt: now },
      },
      select: {
        id: true,
        reservationExpiresAt: true,
        customer: { select: { user: { select: { name: true, email: true } } } },
      },
    }),
    canViewFinance ? prisma.invoice.findMany({
      where: { status: { in: ["DELINQUENT", "OPEN"] }, dueDate: { lt: now } },
      select: {
        id: true,
        customerId: true,
        dueDate: true,
        amountDueCents: true,
        amountPaidCents: true,
        customer: { select: { user: { select: { name: true, email: true } } } },
      },
    }) : Promise.resolve([]),
    prisma.job.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lt: now } },
      select: {
        id: true,
        type: true,
        scheduledAt: true,
        customer: { select: { user: { select: { name: true, email: true } } } },
      },
    }),
    prisma.maintenanceRequest.findMany({
      where: {
        status: "SUBMITTED",
        openedAt: { lt: addDays(now, -UNREVIEWED_MAINTENANCE_REQUEST_DAYS) },
      },
      select: {
        id: true,
        openedAt: true,
        problem: true,
        customer: { select: { user: { select: { name: true, email: true } } } },
      },
    }),
    prisma.appliance.findMany({
      where: {
        status: "AWAITING_INSPECTION",
        updatedAt: { lt: addDays(now, -UNINSPECTED_RETURN_DAYS) },
      },
      select: { id: true, assetNumber: true, updatedAt: true, applianceType: { select: { name: true } } },
    }),
    canViewFinance ? prisma.job.findMany({
      where: {
        type: "MAINTENANCE_VISIT",
        status: "COMPLETED",
        partsCostCents: null,
        laborCostCents: null,
      },
      select: {
        id: true,
        completedAt: true,
        appliances: {
          take: 1,
          select: { appliance: { select: { assetNumber: true, applianceType: { select: { name: true } } } } },
        },
      },
    }) : Promise.resolve([]),
    prisma.rentalAgreement.findMany({
      where: { status: "ACTIVE", termMonths: { not: null }, startDate: { not: null } },
      select: {
        id: true,
        termMonths: true,
        startDate: true,
        endDate: true,
        customer: { select: { user: { select: { name: true, email: true } } } },
      },
    }),
    prisma.appliance.findMany({
      where: { status: "RENTED", archivedAt: null },
      select: {
        id: true,
        assetNumber: true,
        purchaseDate: true,
        createdAt: true,
        applianceType: { select: { name: true } },
        jobs: {
          where: { job: { type: "MAINTENANCE_VISIT", status: "COMPLETED" } },
          select: { job: { select: { completedAt: true } } },
        },
      },
    }),
    prisma.rentalAgreement.findMany({
      where: {
        status: "SCHEDULED",
        startDate: { lt: addDays(now, -RENEWAL_START_GRACE_DAYS) },
      },
      select: {
        id: true,
        startDate: true,
        customer: { select: { user: { select: { name: true, email: true } } } },
      },
    }),
    canViewFinance ? prisma.rentalAgreement.findMany({
      where: {
        status: "ACTIVE",
        terminationEffectiveOn: { lt: now },
      },
      select: {
        id: true,
        terminationEffectiveOn: true,
        paidInFullInAdvance: true,
        customer: { select: { user: { select: { name: true, email: true } } } },
      },
    }) : Promise.resolve([]),
  ]);

  const items: ExceptionItem[] = [
    ...stuckEndings
      .filter((a) => a.terminationEffectiveOn !== null)
      .map((a) =>
        earlyEndingNotDoneException({
          id: a.id,
          terminationEffectiveOn: a.terminationEffectiveOn as Date,
          prepaid: a.paidInFullInAdvance,
          customerName: customerDisplayName(a.customer),
        }),
      ),
    ...stuckRenewals
      .filter((a): a is typeof a & { startDate: Date } => a.startDate !== null)
      .map((a) =>
        renewalNotStartedException({
          id: a.id,
          startDate: a.startDate,
          customerName: customerDisplayName(a.customer),
        }),
      ),
    ...billingBlockedAgreements
      .filter((a): a is typeof a & { billingBlockedReason: string } => a.billingBlockedReason !== null)
      .map((a) =>
        billingBlockedException({
          id: a.id,
          billingBlockedReason: a.billingBlockedReason!,
          updatedAt: a.updatedAt,
          customerName: customerDisplayName(a.customer),
        }),
      ),
    ...staleReservations
      .filter((a): a is typeof a & { reservationExpiresAt: Date } => a.reservationExpiresAt !== null)
      .map((a) =>
        staleReservationException({
          id: a.id,
          reservationExpiresAt: a.reservationExpiresAt,
          customerName: customerDisplayName(a.customer),
        }),
      ),
    ...pastDueInvoices
      .filter((inv): inv is typeof inv & { dueDate: Date } => inv.dueDate !== null)
      .map((inv) =>
        pastDueInvoiceException({
          id: inv.id,
          customerId: inv.customerId,
          customerName: customerDisplayName(inv.customer),
          dueDate: inv.dueDate!,
          amountDueCents: inv.amountDueCents,
          amountPaidCents: inv.amountPaidCents,
        }),
      ),
    ...overdueJobs
      .filter((j): j is typeof j & { scheduledAt: Date } => j.scheduledAt !== null)
      .map((j) =>
        overdueJobException({
          id: j.id,
          type: j.type,
          scheduledAt: j.scheduledAt,
          customerName: j.customer ? customerDisplayName(j.customer) : null,
        }),
      ),
    ...unreviewedRequests.map((r) =>
      unreviewedMaintenanceRequestException({
        id: r.id,
        openedAt: r.openedAt,
        customerName: customerDisplayName(r.customer),
        problem: r.problem,
      }),
    ),
    ...uninspectedAppliances.map((a) =>
      uninspectedReturnException({
        id: a.id,
        assetNumber: a.assetNumber,
        applianceTypeName: a.applianceType.name,
        updatedAt: a.updatedAt,
      }),
    ),
    ...missingRepairCostJobs
      .filter((j): j is typeof j & { completedAt: Date } => j.completedAt !== null)
      .map((j) => {
        const first = j.appliances[0]?.appliance;
        return missingRepairCostException({
          id: j.id,
          completedAt: j.completedAt!,
          applianceLabel: first ? `${first.applianceType.name} ${first.assetNumber}` : null,
        });
      }),
    ...activeTermAgreements
      .filter(
        (a): a is typeof a & { termMonths: number; startDate: Date } =>
          a.termMonths !== null && a.startDate !== null,
      )
      .map((a) => ({ ...a, termEndDate: a.endDate ?? addMonths(a.startDate, a.termMonths) }))
      .filter((a) => a.termEndDate < now)
      .map((a) =>
        agreementTermExpiredException({
          id: a.id,
          customerName: customerDisplayName(a.customer),
          termMonths: a.termMonths,
          termEndDate: a.termEndDate,
        }),
      ),
    ...rentedAppliances
      .map((a) => {
        const lastMaintenance = a.jobs
          .map((j) => j.job.completedAt)
          .filter((d): d is Date => d !== null)
          .sort((x, y) => y.getTime() - x.getTime())[0];
        const sinceDate = lastMaintenance ?? a.purchaseDate ?? a.createdAt;
        return { ...a, sinceDate };
      })
      .filter((a) => a.sinceDate < addDays(now, -APPLIANCE_MAINTENANCE_DUE_DAYS))
      .map((a) =>
        applianceMaintenanceDueException({
          id: a.id,
          assetNumber: a.assetNumber,
          applianceTypeName: a.applianceType.name,
          sinceDate: a.sinceDate,
        }),
      ),
  ];

  return sortExceptions(items);
}

/** Today's schedule — every job (of any status) due today, earliest
 * first. Used by /desk/today alongside getExceptions(). */
export async function getTodaysJobs(now = new Date()) {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const { start: startOfDay, end: startOfTomorrow } = businessDayBounds(now);

  return prisma.job.findMany({
    where: { scheduledAt: { gte: startOfDay, lt: startOfTomorrow } },
    select: {
      id: true, type: true, status: true, scheduledAt: true,
      customer: { select: { user: { select: { name: true, email: true } } } },
      serviceAddress: { select: { line1: true, city: true } },
    },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
  });
}


