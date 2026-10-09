import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/session";
/** Session identity is resolved here; URL property filters can only narrow
 * the signed-in customer's own records. Only customer-visible DTOs are read. */
export async function getPortalHome(rawAddressId?: string) {
  const session = await getServerSession();
  if (!session) return null;
  const customer = await prisma.customer.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      archivedAt: true,
      serviceAddresses: {
        select: { id: true, line1: true, line2: true, city: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!customer || customer.archivedAt) return null;
  const addressId = customer.serviceAddresses.some((a) => a.id === rawAddressId)
    ? rawAddressId
    : undefined;
  const rentalWhere = {
    customerId: customer.id,
    status: "ACTIVE" as const,
    ...(addressId ? { serviceAddressId: addressId } : {}),
  };
  const jobWhere = {
    customerId: customer.id,
    status: {
      in: ["SCHEDULED", "IN_PROGRESS"] as ("SCHEDULED" | "IN_PROGRESS")[],
    },
    ...(addressId ? { serviceAddressId: addressId } : {}),
  };
  const now = new Date();
  const [
    activeRentalCount,
    upcomingVisitCount,
    nextVisit,
    rentals,
    invoice,
    openRequestCount,
  ] = await Promise.all([
    prisma.rentalAgreement.count({ where: rentalWhere }),
    prisma.job.count({ where: jobWhere }),
    prisma.job.findFirst({
      where: { ...jobWhere, scheduledAt: { gte: now } },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      select: {
        type: true,
        status: true,
        scheduledAt: true,
        serviceAddress: { select: { line1: true, line2: true, city: true } },
      },
    }),
    prisma.rentalAgreement.findMany({
      where: rentalWhere,
      take: 6,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        status: true,
        serviceAddress: { select: { line1: true, line2: true, city: true } },
        lines: { select: { label: true, monthlyPriceCents: true } },
        // W-21A: machines away for repair with no replacement yet, so the customer knows a credit is coming.
        outOfServicePeriods: {
          where: { endedOn: null },
          select: { id: true, startedOn: true, appliance: { select: { applianceType: { select: { name: true } } } } },
        },
      },
    }),
    prisma.invoice.findFirst({
      where: {
        customerId: customer.id,
        status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT", "FAILED"] },
        ...(addressId ? { agreement: { serviceAddressId: addressId } } : {}),
      },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        amountDueCents: true,
        amountPaidCents: true,
        dueDate: true,
      },
    }),
    prisma.maintenanceRequest.count({
      where: {
        customerId: customer.id,
        status: { in: ["SUBMITTED", "REVIEWING", "SCHEDULED", "IN_PROGRESS"] },
      },
    }),
  ]);
  return {
    customerId: customer.id,
    properties: customer.serviceAddresses,
    addressId,
    activeRentalCount,
    upcomingVisitCount,
    nextVisit,
    rentals,
    invoice,
    openRequestCount,
  };
}
