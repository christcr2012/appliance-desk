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

/** The appliances currently assigned to this customer through an active
 * (non-unassigned) rental-agreement line — used to prefill the
 * appliance checkboxes when scheduling a job linked to one of their
 * maintenance requests. Staff-side mirror of
 * src/domains/portal/index.ts's getPortalApplianceOptions, keyed by
 * customerId directly rather than resolved from a signed-in userId. */
export async function getCustomerApplianceOptions(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      rentalAgreements: {
        include: {
          lines: {
            include: {
              assignments: {
                where: { unassignedAt: null },
                include: { appliance: { include: { applianceType: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!customer) return [];

  return customer.rentalAgreements.flatMap((a) =>
    a.lines.flatMap((l) =>
      l.assignments.map((asn) => ({
        id: asn.appliance.id,
        label: `${asn.appliance.applianceType.name} (${asn.appliance.assetNumber})`,
      })),
    ),
  );
}
