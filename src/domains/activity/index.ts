import { prisma } from "@/lib/prisma";

/**
 * Reads recent AuditLog entries for /desk/activity — the one place Chris
 * can see who changed what and when, across pricing, settings, appliance
 * types, and leads. Every write elsewhere in the app (settings, leads,
 * ...) is responsible for creating its own AuditLog row; this only reads.
 * See docs/BUSINESS-RULES.md ("Every pricing change is logged... visible
 * in /desk/activity").
 */
export async function getRecentActivity(limit = 50) {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { name: true, email: true } } },
  });
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
  };
  return labels[action] ?? action;
}
