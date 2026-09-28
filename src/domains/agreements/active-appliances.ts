import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// The one, single definition of "this customer's current rental equipment":
// an appliance assigned (not yet unassigned) to a rental line that belongs
// to a currently ACTIVE agreement — never a DRAFT or AWAITING_SIGNATURE
// agreement the customer hasn't signed yet, and never an ENDED/CANCELLED
// one that no longer applies. As of the rental-lifecycle change
// (2026-09-28), it also has to check the appliance's own status: signing
// no longer moves an appliance to RENTED, so an ACTIVE agreement can now
// exist for weeks before the machine is actually delivered — "currently
// belongs to this customer" means it's physically with them (RENTED) or on
// its way back (AWAITING_PICKUP, still there until Chris picks it up), not
// merely reserved for them.
//
// Before this file existed, src/domains/portal/index.ts (getPortalData,
// getPortalApplianceOptions) and src/domains/customers/index.ts
// (getCustomerApplianceOptions) each queried this independently with no
// status filter at all, so a customer could see — and file a maintenance
// request against — an appliance tied to an agreement they hadn't signed.
// Every call site that needs "does this appliance currently belong to this
// customer" goes through here now, so the rule can't drift between the
// owner Desk and the customer portal again.
// ---------------------------------------------------------------------------

/** Reusable relation filter: "this assignment is still in effect, on a line
 * belonging to a currently ACTIVE agreement, AND the appliance is actually
 * with the customer right now." Pass this as (part of) the `where` on an
 * `assignments` include to strip out appliances tied to a DRAFT/
 * AWAITING_SIGNATURE/ENDED/CANCELLED agreement, or ones that are RESERVED
 * (signed but not yet delivered) or already AWAITING_INSPECTION/back at the
 * shop — without losing the agreement itself from the surrounding query
 * (e.g. so a customer can still see a pending draft's status, just not
 * treat its appliances as theirs yet). */
export const ACTIVE_ASSIGNMENT_WHERE = {
  unassignedAt: null,
  rentalLine: { agreement: { status: "ACTIVE" as const } },
  appliance: { status: { in: ["RENTED", "AWAITING_PICKUP"] as const } },
} satisfies Prisma.ApplianceAssignmentWhereInput;

type ApplianceOptionAssignment = {
  appliance: {
    id: string;
    assetNumber: string;
    applianceType: { name: string };
  };
};

function toApplianceOptions(assignments: ApplianceOptionAssignment[]) {
  return assignments.map((asn) => ({
    id: asn.appliance.id,
    label: `${asn.appliance.applianceType.name} (${asn.appliance.assetNumber})`,
  }));
}

async function queryActiveApplianceOptions(agreementFilter: Prisma.RentalAgreementWhereInput) {
  const assignments = await prisma.applianceAssignment.findMany({
    where: {
      unassignedAt: null,
      rentalLine: { agreement: agreementFilter },
      // See ACTIVE_ASSIGNMENT_WHERE's comment above — signing alone no
      // longer means "delivered," so this has to check the appliance is
      // actually with the customer, not just reserved for them.
      appliance: { status: { in: ["RENTED", "AWAITING_PICKUP"] } },
    },
    include: { appliance: { include: { applianceType: true } } },
  });

  return toApplianceOptions(assignments);
}

/** The appliances currently on an ACTIVE agreement for this customer id.
 * Used by the owner Desk (e.g. prefilling a job's appliance checkboxes from
 * a customer's active rentals). */
export async function getActiveApplianceOptionsForCustomer(customerId: string) {
  return queryActiveApplianceOptions({ customerId, status: "ACTIVE" });
}

/** Same as above, resolved from the signed-in user's own id rather than a
 * client-supplied customerId — this is what the customer portal must
 * always use (docs/BUSINESS-RULES.md's customer-data-isolation rule: never
 * trust or accept an id the caller supplies for "which customer's data"). */
export async function getActiveApplianceOptionsForUser(userId: string) {
  return queryActiveApplianceOptions({ status: "ACTIVE", customer: { userId } });
}
