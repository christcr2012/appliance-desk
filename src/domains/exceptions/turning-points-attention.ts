import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { getRentalEndingNoticeDays } from "@/domains/agreements/ending-notice";
import type { ExceptionItem } from "./rules";

type Rows = { rows: ExceptionItem[]; total: number };
const DAY = 86_400_000;
const nameOf = (c: { user: { name: string | null; email: string } } | null) => (c ? c.user.name ?? c.user.email : "customer");
const customerSelect = { customer: { select: { user: { select: { name: true, email: true } } } } } as const;

function bounded(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("A bounded task limit is required.");
}

/** A fixed-term rental ends within the owner's notice window and nobody has decided what happens next. One row per rental. */
export async function listRentalEndingSoon(limit: number, now: Date): Promise<Rows> {
  await requireRole("OWNER", "ADMIN");
  bounded(limit);
  const days = await getRentalEndingNoticeDays();
  const candidates = await prisma.rentalAgreement.findMany({
    where: { status: "ACTIVE", termMonths: { not: null }, terminationRequestedAt: null,
      endDate: { gte: now, lte: new Date(now.getTime() + days * DAY) } },
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
    })),
    total: open.length,
  };
}

/** A draft pickup visit exists but has no date yet. */
export async function listPickupUnscheduled(limit: number): Promise<Rows> {
  await requireRole("OWNER", "ADMIN");
  bounded(limit);
  const where = { type: "REMOVAL" as const, status: "SCHEDULED" as const, scheduledAt: null, agreementId: { not: null } };
  const jobs = await prisma.job.findMany({
    where, select: { id: true, createdAt: true, customer: { select: { user: { select: { name: true, email: true } } } },
      agreement: { select: { terminationEffectiveOn: true, endDate: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit,
  });
  return {
    rows: jobs.map((j): ExceptionItem => {
      const needed = j.agreement?.terminationEffectiveOn ?? j.agreement?.endDate ?? undefined;
      return {
        category: "PICKUP_UNSCHEDULED", severity: "medium", title: "Schedule " + nameOf(j.customer) + "'s pickup",
        detail: "This rental is ending. A draft pickup visit exists with no date. Nothing is sent to the customer until you schedule it.",
        href: "/desk/jobs/" + encodeURIComponent(j.id), since: j.createdAt, ...(needed ? { dueOn: needed } : {}),
      };
    }),
    total: jobs.length < limit ? jobs.length : await prisma.job.count({ where }),
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
  return {
    rows: jobs.map((j): ExceptionItem => ({
      category: "VISIT_NEEDS_ASSIGNMENT", severity: "high",
      title: "Assign / set a time — " + nameOf(j.customer),
      detail: j.scheduledAt ? "This visit is within 2 days and nobody is assigned." : "This pickup is needed within 2 days and has no time yet.",
      href: "/desk/jobs/" + encodeURIComponent(j.id), since: j.createdAt, ...(j.scheduledAt ? { dueOn: j.scheduledAt } : {}),
    })),
    total: jobs.length < limit ? jobs.length : await prisma.job.count({ where }),
  };
}
