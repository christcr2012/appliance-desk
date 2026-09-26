import { prisma } from "@/lib/prisma";

/**
 * Customers — created today only via lead conversion (see
 * src/domains/leads' convertLeadToCustomer). This file just reads them
 * for the desk UI; there's no "add a customer directly" flow yet since
 * every customer needs a login-capable User account, and the lead flow
 * already handles creating one correctly.
 */
export async function getCustomers() {
  return prisma.customer.findMany({
    where: { archivedAt: null },
    include: {
      user: { select: { name: true, email: true } },
      serviceAddresses: true,
      _count: { select: { rentalAgreements: true } },
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function getCustomerById(id: string) {
  return prisma.customer.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, email: true } },
      serviceAddresses: true,
      rentalAgreements: {
        include: { serviceAddress: true, lines: true },
        orderBy: [{ createdAt: "desc" }],
      },
      jobs: {
        include: { serviceAddress: true },
        orderBy: [{ scheduledAt: "desc" }],
      },
    },
  });
}
