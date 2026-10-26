import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { getRentalEndingNoticeDays } from "@/domains/agreements/ending-notice";
import { agreementIdsNeedingPickup } from "@/domains/agreements/pickup-needed";
import { customerContact, type ExceptionItem } from "./rules";

type Rows = { rows: ExceptionItem[]; total: number };
const DAY = 86_400_000;
const nameOf = (c: { user: { name: string | null; email: string } } | null) => (c ? c.user.name ?? c.user.email : "customer");
const customerSelect = { customer: { select: { phone: true, user: { select: { name: true, email: true } } } } } as const;

function bounded(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("A bounded task limit is required.");
}

/** A fixed-term rental ends within the owner's notice window and nobody has decided what happens next. One row per rental. */
export async function listRentalEndingSoon(limit: number, now: Date, scope?: { customerId?: string }): Promise<Rows> {
  await requireRole("OWNER", "ADMIN");
  bounded(limit);
  const days = await getRentalEndingNoticeDays();
  const candidates = await prisma.rentalAgreement.findMany({
    where: { status: "ACTIVE", termMonths: { not: null }, terminationRequestedAt: null,
      endDate: { gte: now, lte: new Date(now.getTime() + days * DAY) },
      ...(scope?.customerId ? { customerId: scope.customerId } : {}) },
    select: { id: true, endDate: true, ...customerSelect }, orderBy: [{ endDate: "asc" }, { id: "asc" }], take: 200,
  });
  const renewed = new Set((await prisma.rentalAgreement.findMany({
    where: { renewedFromAgreementId: { in: candidates.map((c) => c.id) }, status: { not: "CANCELLED" } },
    select: { renewedFromAgreementId: true },
  })).map((r) => r.renewedFromAgreementId));
  const open = candidates.filter((c) => !renewed.has(c.id));
  return {
    rows: open.slice(0, limit).map((a): ExceptionItem => ({
      category: "RENTAL_ENDING_SOON", severity: "medium",
      title: nameOf(a.customer) + "'s rental is ending soon",
      detail: "Choose Renew, Month-to-month or Pickup. Renewing only starts a draft; nothing is sent or charged until you send it.",
      href: "/desk/agreements/" + encodeURIComponent(a.id) + "/ending-decision",
      since: new Date((a.endDate as Date).getTime() - days * DAY), dueOn: a.endDate as Date,
      contact: customerContact(a.customer),
    })),
    total: open.length,
  };
}

/** A draft pickup visit exists but has no date yet. */
export async function listPickupUnscheduled(limit: number, scope?: { customerId?: string }): Promise<Rows> {
  await requireRole("OWNER", "ADMIN");
  bounded(limit);
  const where = {
    type: "REMOVAL" as const, status: "SCHEDULED" as const, scheduledAt: null, agreementId: { not: null },
    ...(scope?.customerId ? { customerId: scope.customerId } : {}),
  };
  const jobs = await prisma.job.findMany({
    where, select: { id: true, createdAt: true, customer: { select: { phone: true, user: { select: { name: true, email: true } } } },
      agreement: { select: { terminationEffectiveOn: true, endDate: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit,
  });
  // E1 safety net: a rental that is over or ending with appliances still out but no pickup visit at all.
  const missingVisit = await agreementIdsNeedingPickup(new Date(), limit, scope?.customerId);
  const missingRows = missingVisit.map((a): ExceptionItem => ({
    category: "PICKUP_UNSCHEDULED", severity: "medium", title: "Schedule " + a.name + "'s pickup",
    detail: "This rental is over or ending and appliances are still at the customer's. Open it and press Schedule the pickup.",
    href: "/desk/agreements/" + encodeURIComponent(a.id), since: a.since, ...(a.dueOn ? { dueOn: a.dueOn } : {}),
    contact: customerContact(a.customer),
  }));
  return {
    rows: [...missingRows, ...jobs.map((j): ExceptionItem => {
      const needed = j.agreement?.terminationEffectiveOn ?? j.agreement?.endDate ?? undefined;
      return {
        category: "PICKUP_UNSCHEDULED", severity: "medium", title: "Schedule " + nameOf(j.customer) + "'s pickup",
        detail: "This rental is ending. A draft pickup visit exists with no date. Nothing is sent to the customer until you schedule it.",
        href: "/desk/jobs/" + encodeURIComponent(j.id), since: j.createdAt, ...(needed ? { dueOn: needed } : {}),
        contact: customerContact(j.customer),
      };
    })].slice(0, limit),
    total: (jobs.length < limit ? jobs.length : await prisma.job.count({ where })) + missingVisit.length,
  };
}

/** A visit due within 2 days has no technician, or a pickup needed within 2 days still has no time. */
export async function listVisitNeedsAssignment(limit: number, now: Date): Promise<Rows> {
  await requireRole("OWNER", "ADMIN");
  bounded(limit);
  const horizon = new Date(now.getTime() + 2 * DAY);
  const where = {
    status: "SCHEDULED" as const,
    OR: [
      { scheduledAt: { gte: now, lte: horizon }, assignedToUserId: null },
      { scheduledAt: null, type: "REMOVAL" as const, agreement: { is: { OR: [
        { terminationEffectiveOn: { lte: horizon } }, { terminationEffectiveOn: null, endDate: { lte: horizon } } ] } } },
    ],
  };
  const jobs = await prisma.job.findMany({
    where, select: { id: true, type: true, scheduledAt: true, assignedToUserId: true, createdAt: true,
      customer: { select: { user: { select: { name: true, email: true } } } } },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], take: limit,
  });
  // W-17 (E3): a repair visit drafted by a failed inspection has no date yet.
  const repairWhere = { type: "MAINTENANCE_VISIT" as const, status: "SCHEDULED" as const, scheduledAt: null };
  const drafts = await prisma.job.findMany({
    where: repairWhere, select: { id: true, createdAt: true, appliances: { select: { appliance: { select: { assetNumber: true, applianceType: { select: { name: true } } } } }, take: 1 } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit,
  });
  const draftRows = drafts.map((j): ExceptionItem => {
    const a = j.appliances[0]?.appliance;
    return {
      category: "VISIT_NEEDS_ASSIGNMENT", severity: "medium",
      title: "Schedule the repair" + (a ? " — " + a.applianceType.name + " (" + a.assetNumber + ")" : ""),
      detail: "A repair visit was drafted and has no date or technician yet. Nothing is sent to a customer.",
      href: "/desk/jobs/" + encodeURIComponent(j.id), since: j.createdAt,
    };
  });
  const draftTotal = drafts.length < limit ? drafts.length : await prisma.job.count({ where: repairWhere });
  return {
    rows: [...draftRows, ...jobs.map((j): ExceptionItem => ({
      category: "VISIT_NEEDS_ASSIGNMENT", severity: "high",
      title: "Assign / set a time — " + nameOf(j.customer),
      detail: j.scheduledAt ? "This visit is within 2 days and nobody is assigned." : "This pickup is needed within 2 days and has no time yet.",
      href: "/desk/jobs/" + encodeURIComponent(j.id), since: j.createdAt, ...(j.scheduledAt ? { dueOn: j.scheduledAt } : {}),
    }))].slice(0, limit),
    total: (jobs.length < limit ? jobs.length : await prisma.job.count({ where })) + draftTotal,
  };
}

/** W-17: appliances that passed inspection and are waiting for "Cleaning done". Oldest first; opens the appliance. */
export async function listCleaningNeeded(limit: number): Promise<Rows> {
  await requireRole("OWNER", "ADMIN");
  bounded(limit);
  const where = { status: "CLEANING" as const };
  const rows = await prisma.appliance.findMany({
    where, select: { id: true, assetNumber: true, updatedAt: true, applianceType: { select: { name: true } } },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: limit,
  });
  return {
    rows: rows.map((a): ExceptionItem => ({
      category: "CLEANING_NEEDED", severity: "medium",
      title: "Clean " + a.applianceType.name + " (" + a.assetNumber + ")",
      detail: "It passed inspection. Press Cleaning done on its page when it is clean; it can't be rented before that.",
      href: "/desk/inventory/" + encodeURIComponent(a.id), since: a.updatedAt,
    })),
    total: rows.length < limit ? rows.length : await prisma.appliance.count({ where }),
  };
}
