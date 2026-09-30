import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import type { Prisma } from "@prisma/client";

// Unknown/new actions are not silently exposed to STAFF. Finance/settings
// counts obey the same boundary as the page entries.
const STAFF_ACTIVITY_ACTIONS = [
  "lead.status", "lead.note.add", "job.create", "job.status", "job.photo.add",
  "job.checklist", "maintenance.request.create", "maintenance.create",
  "maintenance.status", "customer.create", "customer.address.add",
  "customer.note.add", "appliance.unit.status", "task.create", "task.complete", "task.reopen",
];

async function activityWhere(since?: Date): Promise<Prisma.AuditLogWhereInput> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const finance = ["OWNER", "ADMIN"].includes((session.user as { role?: string }).role ?? "");
  return { ...(since ? { createdAt: { gte: since } } : {}),
    ...(!finance ? { action: { in: STAFF_ACTIVITY_ACTIONS } } : {}),
  };
}

/**
 * Reads recent AuditLog entries for /desk/activity — the one place Chris
 * can see who changed what and when, across pricing, settings, appliance
 * types, and leads. Every write elsewhere in the app (settings, leads,
 * ...) is responsible for creating its own AuditLog row; this only reads.
 * See docs/BUSINESS-RULES.md ("Every pricing change is logged... visible
 * in /desk/activity").
 */
/** Total AuditLog row count — used to clamp the page number for
 * /desk/activity's paginated view (src/domains/pagination.ts). `since`
 * narrows it to the "Today"/"This week" quick filters added 2026-09-29
 * (Chris's CRM brainstorm — a combined "what did I actually do"
 * view — see docs/DECISIONS.md); omitted, it's the whole history, same
 * as before. */
export async function getActivityCount(since?: Date): Promise<number> {
  return prisma.auditLog.count({ where: await activityWhere(since) });
}

/** Paginated view of the audit log, for paging back through the full
 * history (or, with `since`, just the window a quick filter picked). */
export async function getActivityPage(skip: number, pageSize: number, since?: Date) {
  return prisma.auditLog.findMany({
    where: await activityWhere(since),
    orderBy: { createdAt: "desc" },
    skip,
    take: pageSize,
    select: { id: true, action: true, entityType: true, entityId: true, createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });
}

export type ActivitySummary = { category: string; count: number }[];

/** A "what did I actually do" breakdown since `since`, grouped by the
 * business area an action belongs to (leads contacted, estimates sent,
 * jobs done, payments collected, ...) rather than the raw AuditLog
 * action list — the point of this over just reading /desk/activity's
 * normal list is to answer "how much did I get done today/this week" at
 * a glance instead of counting rows by eye. Small, in-memory grouping
 * (same reasoning as getLeadSourceBreakdown's own comment) — fine at
 * today's data volume. */
export async function getActivitySummary(since: Date): Promise<ActivitySummary> {
  const entries = await prisma.auditLog.findMany({
    where: await activityWhere(since),
    select: { action: true },
  });

  const CATEGORY_BY_PREFIX: [string, string][] = [
    ["lead.", "Lead activity"],
    ["estimate.", "Estimates"],
    ["agreement.", "Agreements"],
    ["job.", "Jobs"],
    ["billing.", "Billing"],
    ["maintenance.", "Maintenance"],
    ["customer.", "Customers"],
    ["appliance.", "Inventory"],
    ["part.", "Parts"],
    ["pricing.", "Pricing"],
    ["settings.", "Settings"],
  ];

  const counts = new Map<string, number>();
  for (const entry of entries) {
    const match = CATEGORY_BY_PREFIX.find(([prefix]) => entry.action.startsWith(prefix));
    const category = match ? match[1] : "Other";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/** Plain-English label for an AuditLog action code, e.g. "lead.convert" →
 * "Converted a lead to a customer". Falls back to the raw code for any
 * action this hasn't been taught yet, rather than showing nothing. */
export function describeAuditAction(action: string): string {
  const labels: Record<string, string> = {
    "settings.update": "Updated business settings",
    "pricing.update": "Changed an appliance's price",
    "appliance.create": "Added a new appliance type",
    "appliance.retire": "Retired an appliance type",
    "appliance.restore": "Restored a retired appliance type",
    "appliance.photo": "Set an appliance type's photo",
    "appliance.visibility": "Changed whether an appliance type shows on the website",
    "lead.status": "Changed a lead's status",
    "lead.convert": "Converted a lead to a customer",
    "appliance.unit.create": "Added an appliance to inventory",
    "appliance.unit.status": "Changed an appliance's status",
    "appliance.unit.update": "Updated an appliance's details",
    "part.create": "Logged a part number for a model",
    "part.delete": "Removed a logged part number",
    "agreement.create": "Started a new rental agreement",
    "agreement.line.add": "Added an appliance to a rental agreement",
    "agreement.line.remove": "Removed an appliance from a rental agreement",
    "agreement.send_for_signature": "Sent a rental agreement for signature",
    "agreement.sign": "A customer signed their rental agreement",
    "agreement.end": "Ended a rental agreement",
    "agreement.cancel": "Cancelled a rental agreement",
    "job.create": "Scheduled a job",
    "job.status": "Changed a job's status",
    "job.photo.add": "Added a condition photo to a job",
    "maintenance.request.create": "A customer submitted a maintenance request",
    "maintenance.status": "Changed a maintenance request's status",
    "lead.create.manual": "Added a lead directly",
    "estimate.create": "Created an estimate",
    "estimate.send": "Sent an estimate",
    "estimate.line.add": "Added a line to an estimate",
    "estimate.line.remove": "Removed a line from an estimate",
    "estimate.convert": "Converted an approved estimate to an agreement",
    "customer.create": "Added a customer directly",
  };
  return labels[action] ?? action;
}

