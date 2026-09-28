import { prisma } from "@/lib/prisma";
import {
  UNINSPECTED_RETURN_DAYS,
  UNREVIEWED_MAINTENANCE_REQUEST_DAYS,
  billingBlockedException,
  missingRepairCostException,
  overdueJobException,
  pastDueInvoiceException,
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
  const now = new Date();

  const [
    billingBlockedAgreements,
    staleReservations,
    pastDueInvoices,
    overdueJobs,
    unreviewedRequests,
    uninspectedAppliances,
    missingRepairCostJobs,
  ] = await Promise.all([
    prisma.rentalAgreement.findMany({
      where: { billingBlockedReason: { not: null } },
      select: {
        id: true,
        billingBlockedReason: true,
        updatedAt: true,
        customer: { include: { user: { select: { name: true, email: true } } } },
      },
    }),
    prisma.rentalAgreement.findMany({
      where: {
        status: { in: ["DRAFT", "AWAITING_SIGNATURE"] },
        reservationExpiresAt: { lt: now },
      },
      select: {
        id: true,
        reservationExpiresAt: true,
        customer: { include: { user: { select: { name: true, email: true } } } },
      },
    }),
    prisma.invoice.findMany({
      where: { status: { in: ["DELINQUENT", "OPEN"] }, dueDate: { lt: now } },
      select: {
        id: true,
        customerId: true,
        dueDate: true,
        amountDueCents: true,
        amountPaidCents: true,
        customer: { include: { user: { select: { name: true, email: true } } } },
      },
    }),
    prisma.job.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lt: now } },
      select: {
        id: true,
        type: true,
        scheduledAt: true,
        customer: { include: { user: { select: { name: true, email: true } } } },
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
        customer: { include: { user: { select: { name: true, email: true } } } },
      },
    }),
    prisma.appliance.findMany({
      where: {
        status: "AWAITING_INSPECTION",
        updatedAt: { lt: addDays(now, -UNINSPECTED_RETURN_DAYS) },
      },
      select: { id: true, assetNumber: true, updatedAt: true, applianceType: { select: { name: true } } },
    }),
    prisma.job.findMany({
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
    }),
  ]);

  const items: ExceptionItem[] = [
    ...billingBlockedAgreements
      .filter((a): a is typeof a & { billingBlockedReason: string } => a.billingBlockedReason !== null)
      .map((a) =>
        billingBlockedException({
          id: a.id,
          billingBlockedReason: a.billingBlockedReason,
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
          dueDate: inv.dueDate,
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
          completedAt: j.completedAt,
          applianceLabel: first ? `${first.applianceType.name} ${first.assetNumber}` : null,
        });
      }),
  ];

  return sortExceptions(items);
}

/** Today's schedule — every job (of any status) due today, earliest
 * first. Used by /desk/today alongside getExceptions(). */
export async function getTodaysJobs() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = addDays(startOfDay, 1);

  return prisma.job.findMany({
    where: { scheduledAt: { gte: startOfDay, lt: startOfTomorrow } },
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      serviceAddress: true,
    },
    orderBy: [{ scheduledAt: "asc" }],
  });
}
