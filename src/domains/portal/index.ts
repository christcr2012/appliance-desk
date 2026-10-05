import { prisma } from "@/lib/prisma";
import type { JobStatus, JobType, MaintenanceStatus, RentalAgreementStatus } from "@prisma/client";
import { describeSnapshotTerms, snapshotAutoRenew, type TermsDisclosure } from "@/domains/agreements/terms-snapshot";
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

export const PORTAL_PAGE_SIZE = 20;

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
        take: PORTAL_PAGE_SIZE,
      },
      maintenanceRequests: {
        include: { appliance: { include: { applianceType: true } } },
        orderBy: [{ createdAt: "desc" }],
        take: PORTAL_PAGE_SIZE,
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
  /** Blob URLs already uploaded via PhotoUploadField (2026-09-28) — a
   * photo of the actual problem, e.g. a leak or a broken part. Optional;
   * most requests won't have one. */
  photoUrls?: string[];
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

// ---------------------------------------------------------------------------
// SMS notification preference (Task #71, docs/BUSINESS-RULES.md's privacy
// baseline: "an SMS opt-in checkbox (TCPA-compliant) is required before
// any texting feature is added" — real, recorded consent, never assumed
// just because a phone number is on file). Lives on /account/settings.
// ---------------------------------------------------------------------------

/** Turns SMS notifications on or off for this signed-in customer, and
 * lets them update their phone number in the same step (opting in with
 * no phone number on file — theirs or a new one given here — would be
 * pointless, so this is validated together rather than as two separate
 * forms). Always writes a ConsentRecord alongside the Customer row
 * change, whichever direction: an audit trail of consent actually given
 * or withdrawn, not just the current on/off state. */
export async function updateSmsPreference(
  userId: string,
  input: { optedIn: boolean; phone: string | null },
): Promise<{ phone: string | null; smsOptInAt: Date | null }> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { userId } });
  const phone = input.phone?.trim() || customer.phone;

  if (input.optedIn && !phone) {
    throw new Error("Add a phone number before turning on text notifications.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.customer.update({
      where: { id: customer.id },
      data: {
        phone,
        smsOptInAt: input.optedIn ? new Date() : null,
      },
    });

    await tx.consentRecord.create({
      data: {
        customerId: customer.id,
        kind: "sms_opt_in",
        details: { optedIn: input.optedIn },
      },
    });

    return row;
  });

  return { phone: updated.phone, smsOptInAt: updated.smsOptInAt };
}

// ---------------------------------------------------------------------------
// Whitelisted views for the portal pages (WU-D8). Each field is named here on
// purpose: staff notes, completion notes, outcome notes, assigned staff, cost
// and internal task text are never selected, so no page can leak them by
// accident. Identity always comes from the session's user id.
// ---------------------------------------------------------------------------

export type PortalAgreementView = {
  id: string;
  status: RentalAgreementStatus;
  termMonths: number | null;
  startDate: Date | null;
  endDate: Date | null;
  depositCents: number;
  freeMonthGranted: boolean;
  renewalPreference: string | null;
  terminationRequestedAt: Date | null;
  terminationEffectiveOn: Date | null;
  nextBillingDate: Date | null;
  serviceAddress: { line1: string; city: string };
  lines: {
    id: string;
    label: string;
    monthlyPriceCents: number;
    listPriceCents: number;
    prepayDiscountCentsPerMonth: number;
    appliances: string[];
  }[];
  monthlyTotalCents: number;
  terms: TermsDisclosure;
  /** The agreement's own saved terms include an auto-renew section. */
  autoRenewAgreed: boolean;
  /** A follow-on agreement already scheduled to start after this one. */
  renewalStartsOn: Date | null;
  /** A saved copy of what was signed exists to download. */
  hasSignedCopy: boolean;
  /** The customer's next scheduled visit for this agreement, if any. */
  nextVisit: { type: JobType; scheduledAt: Date } | null;
};

export type PortalJobView = {
  id: string;
  type: JobType;
  status: JobStatus;
  scheduledAt: Date | null;
};

export type PortalRequestView = {
  id: string;
  problem: string;
  status: MaintenanceStatus;
  openedAt: Date;
  appliance: { typeName: string; assetNumber: string } | null;
};

export const PORTAL_AGREEMENT_KEYS = [
  "autoRenewAgreed", "depositCents", "endDate", "freeMonthGranted", "hasSignedCopy", "id", "lines", "monthlyTotalCents",
  "nextBillingDate", "nextVisit", "renewalPreference", "renewalStartsOn", "serviceAddress", "startDate", "status",
  "termMonths", "terminationEffectiveOn", "terminationRequestedAt", "terms",
] as const;
export const PORTAL_JOB_KEYS = ["id", "scheduledAt", "status", "type"] as const;
export const PORTAL_REQUEST_KEYS = ["appliance", "id", "openedAt", "problem", "status"] as const;

/** The signed-in customer's agreements (all of them, newest first) and their latest visits, as safe views. */
export async function getPortalRentals(userId: string, opts: { jobLimit?: number } = {}) {
  const jobLimit = Math.min(Math.max(opts.jobLimit ?? PORTAL_PAGE_SIZE, 1), 200);
  const customer = await prisma.customer.findUnique({
    where: { userId },
    select: {
      id: true,
      rentalAgreements: {
        take: 50,
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true, status: true, termMonths: true, startDate: true, endDate: true, depositCents: true,
          freeMonthGranted: true, renewalPreference: true, terminationRequestedAt: true,
          terminationEffectiveOn: true, nextBillingDate: true, termsSnapshot: true,
          serviceAddress: { select: { line1: true, city: true } },
          lines: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true, label: true, monthlyPriceCents: true, listPriceCents: true, prepayDiscountCentsPerMonth: true,
              assignments: {
                where: ACTIVE_ASSIGNMENT_WHERE,
                select: { appliance: { select: { assetNumber: true, applianceType: { select: { name: true } } } } },
              },
            },
          },
        },
      },
      jobs: {
        take: jobLimit + 1,
        orderBy: [{ scheduledAt: "desc" }],
        select: { id: true, type: true, status: true, scheduledAt: true, agreementId: true },
      },
    },
  });
  if (!customer) return null;

  const ids = customer.rentalAgreements.map((a) => a.id);
  const followOns = ids.length
    ? await prisma.rentalAgreement.findMany({
        where: { renewedFromAgreementId: { in: ids }, customerId: customer.id, status: { not: "CANCELLED" } },
        select: { renewedFromAgreementId: true, startDate: true },
      })
    : [];
  const signedCopies = ids.length
    ? await prisma.documentArtifact.findMany({
        where: { kind: "SIGNED_AGREEMENT", subjectType: "RentalAgreement", subjectId: { in: ids }, customerId: customer.id },
        select: { subjectId: true },
      })
    : [];
  const signedCopyIds = new Set(signedCopies.map((c) => c.subjectId));
  const now = new Date();
  const nextVisitFor = (agreementId: string) =>
    customer.jobs
      .filter((j) => j.agreementId === agreementId && j.status === "SCHEDULED" && j.scheduledAt && j.scheduledAt >= now)
      .sort((x, y) => x.scheduledAt!.getTime() - y.scheduledAt!.getTime())[0];

  const agreements: PortalAgreementView[] = customer.rentalAgreements.map((a) => {
    const lines = a.lines.map((l) => ({
      id: l.id,
      label: l.label,
      monthlyPriceCents: l.monthlyPriceCents,
      listPriceCents: l.listPriceCents,
      prepayDiscountCentsPerMonth: l.prepayDiscountCentsPerMonth,
      appliances: l.assignments.map((asn) => `${asn.appliance.applianceType.name} ${asn.appliance.assetNumber}`),
    }));
    const visit = nextVisitFor(a.id);
    const followOn = followOns
      .filter((f) => f.renewedFromAgreementId === a.id && f.startDate && f.startDate > now)
      .sort((x, y) => x.startDate!.getTime() - y.startDate!.getTime())[0];
    return {
      id: a.id,
      status: a.status,
      termMonths: a.termMonths,
      startDate: a.startDate,
      endDate: a.endDate,
      depositCents: a.depositCents,
      freeMonthGranted: a.freeMonthGranted,
      renewalPreference: a.renewalPreference,
      terminationRequestedAt: a.terminationRequestedAt,
      terminationEffectiveOn: a.terminationEffectiveOn,
      nextBillingDate: a.nextBillingDate,
      serviceAddress: a.serviceAddress,
      lines,
      monthlyTotalCents: lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0),
      terms: describeSnapshotTerms(a.termsSnapshot),
      autoRenewAgreed: snapshotAutoRenew(a.termsSnapshot) !== null,
      renewalStartsOn: followOn?.startDate ?? null,
      hasSignedCopy: signedCopyIds.has(a.id),
      nextVisit: visit ? { type: visit.type, scheduledAt: visit.scheduledAt! } : null,
    };
  });

  const jobs: PortalJobView[] = customer.jobs.slice(0, jobLimit).map((j) => ({
    id: j.id, type: j.type, status: j.status, scheduledAt: j.scheduledAt,
  }));
  return { customerId: customer.id, agreements, jobs, hasMoreJobs: customer.jobs.length > jobLimit };
}

/** One page of the signed-in customer's own maintenance requests (newest first). */
export async function getPortalRequests(userId: string, opts: { limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? PORTAL_PAGE_SIZE, 1), 200);
  const customer = await prisma.customer.findUnique({ where: { userId }, select: { id: true } });
  if (!customer) return null;
  const rows = await prisma.maintenanceRequest.findMany({
    where: { customerId: customer.id },
    orderBy: [{ createdAt: "desc" }],
    take: limit + 1,
    select: {
      id: true, problem: true, status: true, openedAt: true,
      appliance: { select: { assetNumber: true, applianceType: { select: { name: true } } } },
    },
  });
  const requests: PortalRequestView[] = rows.slice(0, limit).map((r) => ({
    id: r.id,
    problem: r.problem,
    status: r.status,
    openedAt: r.openedAt,
    appliance: r.appliance ? { typeName: r.appliance.applianceType.name, assetNumber: r.appliance.assetNumber } : null,
  }));
  return { customerId: customer.id, requests, hasMore: rows.length > limit };
}
