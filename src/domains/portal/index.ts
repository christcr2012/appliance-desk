import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { getBusinessSettings } from "@/domains/settings";
import {
  ACTIVE_ASSIGNMENT_WHERE,
  getActiveApplianceOptionsForUser,
} from "@/domains/agreements/active-appliances";

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
              // Every agreement they have shows up here (including a
              // pending DRAFT/AWAITING_SIGNATURE one, so the customer can
              // see it's in progress) — but the specific appliances only
              // show up as "assigned" once the agreement is ACTIVE. Until
              // then, this isn't yet their equipment; showing it would
              // leak reserved-but-unsigned appliance detail (see
              // docs/BUSINESS-RULES.md's customer-data-isolation rule).
              assignments: {
                where: ACTIVE_ASSIGNMENT_WHERE,
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
 * only ones currently assigned to them through an ACTIVE agreement (never
 * a DRAFT/AWAITING_SIGNATURE one they haven't signed, or an ENDED/CANCELLED
 * one that no longer applies). Used both to populate the portal's dropdown
 * and to validate a submission server-side (never trust a client-supplied
 * applianceId at face value). Shared definition in
 * src/domains/agreements/active-appliances.ts — see its comment for why. */
export async function getPortalApplianceOptions(userId: string) {
  return getActiveApplianceOptionsForUser(userId);
}

export type NewMaintenanceRequestInput = {
  problem: string;
  applianceId?: string | null;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
};

/** The customer's own submission — resolves their Customer row from
 * their session's userId (never a client-supplied customerId), and if
 * they named a specific appliance, verifies it's actually one of theirs
 * before accepting it. Emails Chris a notification the same way a new
 * lead does (docs/BUSINESS-RULES.md); a failed notification never fails
 * the submission — the customer's request is already saved either way. */
export async function createMaintenanceRequestForUser(
  userId: string,
  input: NewMaintenanceRequestInput,
) {
  const customer = await prisma.customer.findUnique({
    where: { userId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!customer) {
    throw new Error("No customer account found for this login.");
  }

  let applianceLabel: string | null = null;
  if (input.applianceId) {
    const options = await getPortalApplianceOptions(userId);
    const match = options.find((o) => o.id === input.applianceId);
    if (!match) {
      throw new Error("That appliance isn't on one of your active rentals.");
    }
    applianceLabel = match.label;
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

  const settings = await getBusinessSettings();
  const notifyTo = process.env.MAINTENANCE_NOTIFICATION_EMAIL || settings.publicEmail;
  const isUrgent = request.priority === "URGENT" || request.priority === "HIGH";

  await sendEmail({
    to: notifyTo,
    subject: isUrgent
      ? `URGENT maintenance request: ${customer.user.name ?? customer.user.email}`
      : `New maintenance request: ${customer.user.name ?? customer.user.email}`,
    text: [
      `A customer submitted a maintenance request${isUrgent ? " (flagged " + request.priority + ")" : ""}.`,
      "",
      `Customer: ${customer.user.name ?? "(no name on file)"} <${customer.user.email}>`,
      `Appliance: ${applianceLabel ?? "(not specified / general question)"}`,
      `Priority: ${request.priority}`,
      `Problem: ${request.problem}`,
      "",
      "Review it in the Owner Desk under Maintenance.",
    ].join("\n"),
  });

  return request;
}
