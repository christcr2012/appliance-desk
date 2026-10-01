import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const CUSTOMER_TABS = [
  "overview",
  "properties",
  "rentals",
  "service",
  "billing",
  "activity",
] as const;
export type CustomerTab = (typeof CUSTOMER_TABS)[number];
export function customerTab(value?: string): CustomerTab {
  return CUSTOMER_TABS.find((tab) => tab === value) ?? "overview";
}
export async function getCustomerIdentity(id: string) {
  await requireRole("OWNER", "ADMIN");
  return prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      phone: true,
      companyName: true,
      archivedAt: true,
      user: { select: { name: true, email: true } },
    },
  });
}
export async function getCustomerOverview(customerId: string, now = new Date()) {
  await requireRole("OWNER", "ADMIN");
  const [activeRentals, openService, propertyCount, nextJob, tasks] =
    await Promise.all([
      prisma.rentalAgreement.count({ where: { customerId, status: "ACTIVE" } }),
      prisma.maintenanceRequest.count({
        where: {
          customerId,
          status: {
            in: ["SUBMITTED", "REVIEWING", "SCHEDULED", "IN_PROGRESS"],
          },
        },
      }),
      prisma.serviceAddress.count({ where: { customerId } }),
      prisma.job.findFirst({
        where: {
          customerId,
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
          scheduledAt: { gte: now },
        },
        select: {
          id: true,
          type: true,
          status: true,
          scheduledAt: true,
          serviceAddress: { select: { line1: true, city: true } },
        },
        orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      }),
      // Existing shared linked-task behavior; the global Tasks workspace is paginated.
      prisma.staffTask.findMany({
        where: { customerId },
        orderBy: [
          { completedAt: "asc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
      }),
    ]);
  return { activeRentals, openService, propertyCount, nextJob, tasks };
}
export async function getCustomerProperties(customerId: string) {
  await requireRole("OWNER", "ADMIN");
  return prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      serviceAddresses: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      contacts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      rentalAgreements: {
        select: {
          id: true,
          status: true,
          serviceAddressId: true,
          lines: { select: { monthlyPriceCents: true } },
        },
      },
      jobs: {
        where: { status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
        select: { id: true, serviceAddressId: true, scheduledAt: true },
      },
    },
  });
}
function pageMeta(count: number, requested: number) {
  const totalPages = Math.max(1, Math.ceil(count / 25));
  const page = Math.min(
    totalPages,
    Math.max(1, Number.isSafeInteger(requested) ? requested : 1),
  );
  return { page, totalPages, totalCount: count };
}
export async function getCustomerRentals(
  customerId: string,
  requestedPage = 1,
) {
  await requireRole("OWNER", "ADMIN");
  const meta = pageMeta(
    await prisma.rentalAgreement.count({ where: { customerId } }),
    requestedPage,
  );
  const records = await prisma.rentalAgreement.findMany({
    where: { customerId },
    take: 25,
    skip: (meta.page - 1) * 25,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      status: true,
      serviceAddress: { select: { line1: true, city: true } },
      lines: { select: { monthlyPriceCents: true } },
    },
  });
  return { records, ...meta };
}
export async function getCustomerService(
  customerId: string,
  requestedPage = 1,
) {
  await requireRole("OWNER", "ADMIN");
  const [jobCount, openRequestCount, requests] = await Promise.all([
    prisma.job.count({ where: { customerId } }),
    prisma.maintenanceRequest.count({
      where: {
        customerId,
        status: { in: ["SUBMITTED", "REVIEWING", "SCHEDULED", "IN_PROGRESS"] },
      },
    }),
    prisma.maintenanceRequest.findMany({
      where: {
        customerId,
        status: { in: ["SUBMITTED", "REVIEWING", "SCHEDULED", "IN_PROGRESS"] },
      },
      select: {
        id: true,
        problem: true,
        status: true,
        priority: true,
        openedAt: true,
      },
      orderBy: [{ openedAt: "asc" }, { id: "asc" }],
      take: 10,
    }),
  ]);
  const meta = pageMeta(jobCount, requestedPage);
  const jobs = await prisma.job.findMany({
    where: { customerId },
    take: 25,
    skip: (meta.page - 1) * 25,
    orderBy: [{ scheduledAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    select: {
      id: true,
      type: true,
      status: true,
      scheduledAt: true,
      serviceAddress: { select: { line1: true, city: true } },
    },
  });
  return { jobs, requests, openRequestCount, ...meta };
}
export async function getCustomerBillingContext(customerId: string) {
  await requireRole("OWNER", "ADMIN");
  return prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      referralCode: true,
      referredBy: {
        select: {
          referrerCustomerId: true,
          status: true,
          referrerCustomer: {
            select: { user: { select: { name: true, email: true } } },
          },
        },
      },
      referralsMade: {
        select: {
          id: true,
          referredCustomerId: true,
          status: true,
          referredCustomer: {
            select: { user: { select: { name: true, email: true } } },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
      credits: {
        select: {
          id: true,
          remainingCents: true,
          amountCents: true,
          reason: true,
          notes: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
    },
  });
}

/** Prefill is only a convenience: preserve the real write-action ownership checks. */
export function validInitialAddress(
  customers: { id: string; serviceAddresses: { id: string }[] }[],
  customerId?: string,
  addressId?: string,
) {
  if (!customerId || !addressId) return undefined;
  return customers
    .find((c) => c.id === customerId)
    ?.serviceAddresses.some((a) => a.id === addressId)
    ? addressId
    : undefined;
}
