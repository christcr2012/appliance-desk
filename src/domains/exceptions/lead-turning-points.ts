import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { addBusinessDays } from "@/lib/business-date";
import { getLeadResponseDays } from "@/domains/leads/follow-up";
import { leadStageWhere } from "@/domains/leads/stage";
import { customerContact, leadContact, type ExceptionItem } from "./rules";

type Rows = { rows: ExceptionItem[]; total: number };

function bounded(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("A bounded task limit is required.");
}

/** A new lead nobody has contacted yet. Due the owner's response-time setting after it arrived (0 = same day). */
export async function listNewLeadContact(limit: number): Promise<Rows> {
  await requireRole("OWNER", "ADMIN");
  bounded(limit);
  const days = await getLeadResponseDays();
  // LD-1: "New" means never really contacted (firstContactedAt is null),
  // not merely stored NEW — a lead stamped contacted at creation is gone.
  const where = leadStageWhere.new;
  const leads = await prisma.lead.findMany({
    where, select: { id: true, contactName: true, createdAt: true, phone: true, email: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit,
  });
  return {
    rows: leads.map((l): ExceptionItem => ({
      category: "NEW_LEAD_CONTACT", severity: "medium", title: "Contact " + l.contactName,
      detail: "A new lead came in. Call or email them, then mark the lead contacted.",
      href: "/desk/leads/" + encodeURIComponent(l.id), since: l.createdAt,
      dueOn: addBusinessDays(l.createdAt, days), dueDateOnly: true,
      contact: leadContact(l),
    })),
    total: leads.length < limit ? leads.length : await prisma.lead.count({ where }),
  };
}

/** A contacted lead whose chosen follow-up date has come. */
export async function listLeadFollowUps(limit: number, now: Date): Promise<Rows> {
  await requireRole("OWNER", "ADMIN");
  bounded(limit);
  const where = { status: "CONTACTED" as const, mergedIntoLeadId: null, nextFollowUpOn: { not: null, lt: addBusinessDays(now, 1) } };
  const leads = await prisma.lead.findMany({
    where, select: { id: true, contactName: true, nextFollowUpOn: true, phone: true, email: true },
    orderBy: [{ nextFollowUpOn: "asc" }, { id: "asc" }], take: limit,
  });
  return {
    rows: leads.map((l): ExceptionItem => ({
      category: "LEAD_FOLLOW_UP", severity: "medium", title: "Follow up with " + l.contactName,
      detail: "You chose this date to follow up. After you reach them, mark the lead and pick the next date.",
      href: "/desk/leads/" + encodeURIComponent(l.id), since: l.nextFollowUpOn as Date,
      dueOn: l.nextFollowUpOn as Date, dueDateOnly: true,
      contact: leadContact(l),
    })),
    total: leads.length < limit ? leads.length : await prisma.lead.count({ where }),
  };
}

/** A customer approved a quote and nobody has turned it into a rental yet. Due today. */
export async function listApprovedQuoteToRental(limit: number, now: Date): Promise<Rows> {
  await requireRole("OWNER", "ADMIN");
  bounded(limit);
  const where = { status: "APPROVED" as const };
  const quotes = await prisma.estimate.findMany({
    where, select: { id: true, respondedAt: true, updatedAt: true,
      lead: { select: { contactName: true, phone: true, email: true } },
      customer: { select: { phone: true, user: { select: { name: true, email: true } } } } },
    orderBy: [{ respondedAt: "asc" }, { id: "asc" }], take: limit,
  });
  return {
    rows: quotes.map((q): ExceptionItem => ({
      category: "APPROVED_QUOTE", severity: "high",
      title: "Turn " + (q.customer?.user.name ?? q.customer?.user.email ?? q.lead?.contactName ?? "customer") + "'s approved quote into a rental",
      detail: "The customer approved this quote. Open it to set up the rental.",
      href: "/desk/estimates/" + encodeURIComponent(q.id), since: q.respondedAt ?? q.updatedAt,
      dueOn: addBusinessDays(now, 0), dueDateOnly: true,
      contact: q.customer ? customerContact(q.customer) : leadContact(q.lead),
    })),
    total: quotes.length < limit ? quotes.length : await prisma.estimate.count({ where }),
  };
}
