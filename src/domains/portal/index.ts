import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Customer portal (Phase 5, slice 1 — rentals + maintenance requests;
// billing needs Stripe, Phase 6, so it's not here yet). Every function
// here is scoped by the signed-in user's own id — never by an id the
// caller supplies — per docs/BUSINESS-RULES.md's security-critical rule:
// "a customer must never be able to see another customer's records."
// ---------------------------------------------------------------------------

/** Everything /account needs, or null if this signed-in user has no
 * Customer record (e.g. an OWNER/ADMIN account visiting their own
 * /account, which has no rentals of its own). */
export async function getPortalData(userId: string) {
  const customer = await prisma.customer.findUnique({
    where: { userId },
    include: {
      serviceAddresses: true,
      rentalAgreements: {
        include: {
          serviceAddress: true,
          lines: {
            include: {
              assignments: {
                where: { unassignedAt: null },
                include: { appliance: { include: { applianceType: true } } },
              },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }],
      },
      jobs: {
        include: { serviceAddress: true },
        orderBy: [{ scheduledAt: "desc" }],
      },
      maintenanceRequests: {
        include: { appliance: { include: { applianceType: true } } },
        orderBy: [{ createdAt: "desc" }],
      },
    },
  });

  return customer;
}

/** The appliances this customer can file a maintenance request against —
 * only ones currently assigned to them through an active (non-unassigned)
 * line on one of their own agreements. Used both to populate the portal's
 * dropdown and to validate a submission server-side (never trust a
 * client-supplied applianceId at face value). */
export async function getPortalApplianceOptions(userId: string) {
  const customer = await prisma.customer.findUnique({
    where: { userId },
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

export type NewMaintenanceRequestInput = {
  problem: string;
  applianceId?: string | null;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
};

/** The customer's own submission — resolves their Customer row from
 * their session's userId (never a client-supplied customerId), and if
 * they named a specific appliance, verifies it's actually one of theirs
 * before accepting it. */
export async function createMaintenanceRequestForUser(
  userId: string,
  input: NewMaintenanceRequestInput,
) {
  const customer = await prisma.customer.findUnique({ where: { userId } });
  if (!customer) {
    throw new Error("No customer account found for this login.");
  }

  if (input.applianceId) {
    const options = await getPortalApplianceOptions(userId);
    if (!options.some((o) => o.id === input.applianceId)) {
      throw new Error("That appliance isn't on one of your active rentals.");
    }
  }

  const request = await prisma.maintenanceRequest.create({
    data: {
      customerId: customer.id,
      problem: input.problem,
      applianceId: input.applianceId || null,
      priority: input.priority ?? "NORMAL",
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "maintenance.request.create",
      entityType: "MaintenanceRequest",
      entityId: request.id,
    },
  });

  return request;
}
