import { lockCanonicalSmsAddress } from "@/domains/messaging/sms-address-lock";
import { recordPortalSmsChoice } from "@/domains/messaging/portal-consent";
import { prisma } from "@/lib/prisma";
import { deliverMessage } from "@/domains/messaging/deliver";
import { normalizeSmsAddress } from "@/domains/messaging/suppression";
import { getBusinessSettings } from "@/domains/settings";
import {
  ACTIVE_ASSIGNMENT_WHERE,
  getActiveApplianceOptionsForUser,
} from "@/domains/agreements/active-appliances";

import { customerSigningSummary } from "./signing-status";

export const PORTAL_PAGE_SIZE = 20;

const serviceAddressSelect = {
  id: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  zip: true,
} as const;

const jobSelect = {
  id: true,
  type: true,
  status: true,
  scheduledAt: true,
  performedOn: true,
  serviceAddress: { select: serviceAddressSelect },
} as const;

const maintenanceRequestSelect = {
  id: true,
  status: true,
  problem: true,
  priority: true,
  openedAt: true,
  createdAt: true,
  appliance: {
    select: {
      id: true,
      assetNumber: true,
      applianceType: { select: { name: true } },
    },
  },
} as const;

function pageNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return 1;
  return Math.min(value, 500);
}

async function portalCustomerId(userId: string): Promise<string | null> {
  const customer = await prisma.customer.findUnique({
    where: { userId },
    select: { id: true, archivedAt: true },
  });
  return customer && !customer.archivedAt ? customer.id : null;
}

export async function getPortalData(userId: string) {
  const now = new Date();
  const customer = await prisma.customer.findUnique({
    where: { userId },
    select: {
      id: true,
      archivedAt: true,
      phone: true,
      smsOptInAt: true,
      serviceAddresses: {
        select: serviceAddressSelect,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
      rentalAgreements: {
        select: {
          id: true,
          status: true,
          termMonths: true,
          startDate: true,
          endDate: true,
          nextBillingDate: true,
          depositCents: true,
          freeMonthGranted: true,
          paidInFullInAdvance: true,
          renewalPreference: true,
          termsSnapshot: true,
          terminationRequestedAt: true,
          terminationEffectiveOn: true,
          signature: { select: { signedAt: true } },
          signingPaymentObligation: {
            select: {
              agreementId:true,evidenceVersion:true,componentEvidence:true,
              setupFeeCents: true, setupTaxCents: true, downPaymentCents: true,
              totalCents: true, status: true, signedAt: true,
              receipt: { select: { customerId: true, amountCents: true, receivedOn: true } },
            },
          },
          serviceAddress: { select: serviceAddressSelect },
          lines: {
            select: {
              id: true,
              label: true,
              monthlyPriceCents: true,
              listPriceCents: true,
              prepayDiscountCentsPerMonth: true,
              assignments: {
                where: ACTIVE_ASSIGNMENT_WHERE,
                select: {
                  applianceId: true,
                  appliance: {
                    select: {
                      id: true,
                      assetNumber: true,
                      applianceType: { select: { name: true } },
                    },
                  },
                },
              },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
          jobs: {
            where: {
              OR: [
                { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, scheduledAt: { gte: now } },
                // A signed rental may have a real delivery job that the owner
                // has not scheduled yet; never invent an appointment time.
                { type: "DELIVERY", status: "SCHEDULED", scheduledAt: null },
              ],
            },
            select: jobSelect,
            orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
            take: 1,
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
      jobs: {
        select: jobSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PORTAL_PAGE_SIZE + 1,
      },
      maintenanceRequests: {
        select: maintenanceRequestSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PORTAL_PAGE_SIZE + 1,
      },
    },
  });

  if (!customer || customer.archivedAt) return null;
  return {
    id: customer.id,
    phone: customer.phone,
    smsOptInAt: customer.smsOptInAt,
    serviceAddresses: customer.serviceAddresses,
    rentalAgreements: customer.rentalAgreements.map(({ signingPaymentObligation, signature, ...agreement }) => ({
      ...agreement,
      // Do not advertise an unsigned/order-draft visit to the customer.
      // Existing scheduled visits keep their normal visibility.
      jobs: signature?.signedAt ? agreement.jobs : agreement.jobs.filter(job => job.scheduledAt !== null),
      signingPaymentSummary: customerSigningSummary(signingPaymentObligation, customer.id),
    })),
    jobs: customer.jobs.slice(0, PORTAL_PAGE_SIZE),
    jobsHasMore: customer.jobs.length > PORTAL_PAGE_SIZE,
    maintenanceRequests: customer.maintenanceRequests.slice(0, PORTAL_PAGE_SIZE),
    maintenanceHasMore: customer.maintenanceRequests.length > PORTAL_PAGE_SIZE,
  };
}

export async function getPortalJobsPage(userId: string, rawPage: number) {
  const customerId = await portalCustomerId(userId);
  if (!customerId) return null;
  const page = pageNumber(rawPage);
  const rows = await prisma.job.findMany({
    where: { customerId },
    select: jobSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PORTAL_PAGE_SIZE,
    take: PORTAL_PAGE_SIZE + 1,
  });
  return {
    page,
    items: rows.slice(0, PORTAL_PAGE_SIZE),
    hasMore: rows.length > PORTAL_PAGE_SIZE,
  };
}

export async function getPortalMaintenancePage(userId: string, rawPage: number) {
  const customerId = await portalCustomerId(userId);
  if (!customerId) return null;
  const page = pageNumber(rawPage);
  const rows = await prisma.maintenanceRequest.findMany({
    where: { customerId },
    select: maintenanceRequestSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PORTAL_PAGE_SIZE,
    take: PORTAL_PAGE_SIZE + 1,
  });
  return {
    page,
    items: rows.slice(0, PORTAL_PAGE_SIZE),
    hasMore: rows.length > PORTAL_PAGE_SIZE,
  };
}

export async function getPortalApplianceOptions(userId: string) {
  return getActiveApplianceOptionsForUser(userId);
}

export type NewMaintenanceRequestInput = {
  problem: string;
  applianceId?: string | null;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  photoUrls?: string[];
};

export async function createMaintenanceRequestForUser(
  userId: string,
  input: NewMaintenanceRequestInput,
) {
  const customer = await prisma.customer.findUnique({
    where: { userId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!customer) throw new Error("No customer account found for this login.");

  let applianceLabel: string | null = null;
  if (input.applianceId) {
    const options = await getPortalApplianceOptions(userId);
    const match = options.find((o) => o.id === input.applianceId);
    if (!match) throw new Error("That appliance isn't on one of your active rentals.");
    applianceLabel = match.label;
  }

  const photoUrls = (input.photoUrls ?? []).filter(Boolean);
  const request = await prisma.maintenanceRequest.create({
    data: {
      customerId: customer.id,
      problem: input.problem,
      applianceId: input.applianceId || null,
      priority: input.priority ?? "NORMAL",
      photos: photoUrls.length > 0 ? { create: photoUrls.map((url) => ({ url })) } : undefined,
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

  await deliverMessage({
    idempotencyKey: `maintenance-request-staff-${request.id}`,
    channel: "EMAIL",
    purpose: "TRANSACTIONAL",
    templateKey: "maintenance-request-staff",
    customerFacing: false,
    recipient: { type: "Staff", address: notifyTo },
    subject: { type: "MaintenanceRequest", id: request.id },
    render: () => ({
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
    }),
  });

  return request;
}

export async function updateSmsPreference(
  userId: string,
  input: { optedIn: boolean; phone: string | null; disclosureLanguage?: "en" | "es" },
): Promise<{ phone: string | null; smsOptInAt: Date | null }> {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { userId }, select: { id: true, phone: true },
  });
  const rawPhone = input.phone?.trim() || customer.phone;
  if (input.optedIn && !rawPhone) {
    throw new Error("Add a phone number before turning on text notifications.");
  }
  const phone = input.optedIn && rawPhone
    ? normalizeSmsAddress(rawPhone)
    : rawPhone?.trim() || null;

  // Provider STOP takes the address lock before touching Customer. Preserve
  // that same ordering to avoid a STOP-versus-portal deadlock, and reject a
  // concurrent changed phone rather than giving an old number a stale grant.
  const updated = await prisma.$transaction(async (tx) => {
    const locks = new Set<string>();
    for (const value of [customer.phone, phone]) {
      if (!value) continue;
      try { locks.add(normalizeSmsAddress(value)); }
      catch { /* invalid historic numbers have no canonical consent record */ }
    }
    for (const address of [...locks].sort()) await lockCanonicalSmsAddress(tx, address);
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customer.id} FOR UPDATE`;
    const current = await tx.customer.findUniqueOrThrow({
      where: { id: customer.id }, select: { phone: true },
    });
    if (current.phone !== customer.phone) {
      throw new Error("Your phone number changed. Refresh this page and try again.");
    }
    const at = new Date();
    await recordPortalSmsChoice(tx, {
      customerId: customer.id, priorPhone: current.phone, nextPhone: phone,
      optedIn: input.optedIn, at, disclosureLanguage: input.disclosureLanguage,
    });
    const row = await tx.customer.update({
      where: { id: customer.id },
      data: { phone, smsOptInAt: input.optedIn ? at : null },
    });
    await tx.consentRecord.create({
      data: {
        customerId: customer.id,
        kind: "sms_opt_in",
        details: { optedIn: input.optedIn, ...(phone ? { phone } : {}) },
      },
    });
    return row;
  });

  return { phone: updated.phone, smsOptInAt: updated.smsOptInAt };
}


/**
 * A customer asking for appliances to be picked up. This is its own kind of request, not a repair: it becomes one draft
 * pickup visit (no date, no technician) that lands on the owner's To do list as "Schedule <name>'s pickup".
 * The customer's identity comes only from their own session. Nothing is sent, dispatched or charged.
 */
export async function createPickupRequestForUser(
  userId: string,
  input: { note: string; applianceId?: string | null },
): Promise<{ jobId: string; created: boolean }> {
  const { ensurePickupDraftInTx } = await import("@/domains/agreements/pickup-draft");
  const note = input.note.trim().slice(0, 1000);
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { userId }, select: { id: true } });
    if (!customer) throw new Error("No customer account found for this login.");
    const held = await tx.applianceCustodyEpisode.findMany({
      where: { customerId: customer.id, endedOn: null, agreementId: { not: null },
        ...(input.applianceId ? { applianceId: input.applianceId } : {}) },
      select: { agreementId: true, appliance: { select: { assetNumber: true } } },
    });
    if (input.applianceId && held.length === 0) throw new Error("That appliance isn't on one of your active rentals.");
    const agreementIds = [...new Set(held.map((h) => h.agreementId as string))];
    if (agreementIds.length === 0) throw new Error("We couldn't find a current rental to pick appliances up from.");
    if (agreementIds.length > 1) throw new Error("Please choose which appliance you want picked up.");
    const agreementId = agreementIds[0];
    const agreement = await tx.rentalAgreement.findUnique({ where: { id: agreementId }, select: { status: true } });
    if (agreement?.status !== "ACTIVE" && agreement?.status !== "ENDED") throw new Error("We couldn't find a current rental to pick appliances up from.");
    const label = input.applianceId ? ` (appliance ${held[0].appliance.assetNumber})` : "";
    const line = `Customer asked for a pickup${label}: ${note}`;
    const before = await tx.job.findFirst({ where: { agreementId, type: "REMOVAL", status: { not: "CANCELLED" } }, select: { id: true, notes: true } });
    const jobId = await ensurePickupDraftInTx(tx, agreementId, { notes: line });
    if (!jobId) throw new Error("We couldn't find a current rental to pick appliances up from.");
    if (before) await tx.job.update({ where: { id: jobId }, data: { notes: [before.notes, line].filter(Boolean).join("\n") } });
    await tx.auditLog.create({ data: { userId, action: "portal.pickup_request", entityType: "Job", entityId: jobId,
      newValue: { agreementId, created: !before } } });
    return { jobId, created: !before };
  });
}
