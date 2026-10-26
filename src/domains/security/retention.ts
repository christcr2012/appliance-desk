// OPS-7: the nightly clean-up of information we no longer need (C.R.S. 6-1-713). Ships OFF. Bounded per night, logged, and
// it only ever touches enquiries that never became a customer. Signed agreements, bills, payments, tax and mileage
// records are never touched here: the "keep for" years for those only say the earliest date they MAY be removed.
import { prisma } from "@/lib/prisma";
import { PURGE_NIGHTLY_LIMIT, yearsAgo } from "./rules";

export type PurgeResult = { enabled: boolean; leadsRemoved: number; leadsKept: number; cutoff: string | null };

export async function runRetentionPurge(now: Date, limit: number = PURGE_NIGHTLY_LIMIT): Promise<PurgeResult> {
  const settings = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { retentionPurgeEnabled: true, retentionLeadYears: true } });
  if (!settings?.retentionPurgeEnabled) return { enabled: false, leadsRemoved: 0, leadsKept: 0, cutoff: null };
  const cutoff = yearsAgo(now, settings.retentionLeadYears);
  // A customer on legal hold also protects any old enquiry that carries their email or phone.
  const held = await prisma.customer.findMany({ where: { legalHoldAt: { not: null } }, select: { phone: true, user: { select: { email: true } } } });
  const heldEmails = held.map((c) => c.user.email.toLowerCase());
  const heldPhones = held.map((c) => (c.phone ?? "").replace(/\D/g, "")).filter((d) => d.length >= 7);
  // An enquiry that never became a customer, has no estimate, and has been quiet since before the cutoff.
  const candidates = await prisma.lead.findMany({
    where: {
      status: { in: ["NEW", "CONTACTED", "LOST"] },
      convertedCustomerId: null,
      updatedAt: { lt: cutoff },
      estimates: { none: {} },
      // Leads with no stored email or phone key stay eligible; only an exact match to a held customer protects one.
      AND: [
        ...(heldEmails.length ? [{ OR: [{ emailLower: null }, { emailLower: { notIn: heldEmails } }] }] : []),
        ...(heldPhones.length ? [{ OR: [{ phoneDigits: null }, { phoneDigits: { notIn: heldPhones } }] }] : []),
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: Math.max(0, limit),
    select: { id: true },
  });
  let removed = 0;
  let kept = 0;
  for (const { id } of candidates) {
    try {
      // One statement per lead: a lead still referenced elsewhere is refused by the database and simply kept.
      await prisma.lead.delete({ where: { id } });
      removed += 1;
    } catch {
      kept += 1;
    }
  }
  if (removed > 0 || kept > 0) {
    await prisma.auditLog.create({
      data: { userId: null, action: "retention.purge", entityType: "Lead", entityId: "batch", newValue: { removed, kept, cutoff: cutoff.toISOString() } },
    });
  }
  return { enabled: true, leadsRemoved: removed, leadsKept: kept, cutoff: cutoff.toISOString() };
}
