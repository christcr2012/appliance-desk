import { prisma } from "@/lib/prisma";
import { getActiveApplianceOptionsForCustomer } from "@/domains/agreements/active-appliances";

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

/** The appliances currently assigned to this customer through an ACTIVE
 * rental agreement — used to prefill the appliance checkboxes when
 * scheduling a job linked to one of their maintenance requests. Staff-side
 * mirror of src/domains/portal/index.ts's getPortalApplianceOptions; both
 * go through the same shared helper in
 * src/domains/agreements/active-appliances.ts so "what counts as this
 * customer's current rental equipment" can never drift between the two. */
export async function getCustomerApplianceOptions(customerId: string) {
  return getActiveApplianceOptionsForCustomer(customerId);
}
