import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Customer workspace (2026-09-28) — one chronological feed for a customer's
// own page (/desk/customers/[id]), instead of Chris having to piece their
// history together from separate agreement/job/maintenance pages. Merges
// two different kinds of record:
//   - CustomerNote: something a person chose to write down (a call, a
//     reminder) — always shown as-is.
//   - AuditLog: what the system did (status changes, things created) —
//     already recorded everywhere else in this app; this is the first
//     place that reads it back scoped to one customer's whole history
//     rather than one entity's.
// Deliberately read-only and best-effort: a bad/unrecognized audit-log
// action just falls back to its raw action string rather than breaking
// the page.
// ---------------------------------------------------------------------------

export type TimelineEntry = {
  id: string;
  kind: "note" | "activity";
  summary: string;
  detail: string | null;
  authorName: string | null;
  createdAt: Date;
};

/** Human-readable summary for an AuditLog action string — falls back to
 * the raw action if it's one this doesn't specifically know about, so a
 * new action type added elsewhere in the app never makes a customer's
 * timeline silently drop entries, just shows them a little less
 * prettily until this list is updated. */
function summarizeAuditAction(action: string): string {
  const KNOWN: Record<string, string> = {
    "customer.create": "Customer account created",
    "agreement.create": "Rental agreement created",
    "agreement.sign": "Rental agreement signed",
    "agreement.end": "Rental agreement ended",
    "agreement.cancel": "Rental agreement cancelled",
    "agreement.extend_reservation": "Reservation hold extended",
    "job.create": "Job scheduled",
    "job.status": "Job status changed",
    "job.repairCosts": "Repair cost recorded on a job",
    "job.photo.add": "Photo added to a job",
    "maintenance.create": "Maintenance request submitted",
    "maintenance.status": "Maintenance request status changed",
    "billing.signing_payment_failed": "Signing payment failed to clear",
    "billing.subscription_ended": "Recurring billing ended",
  };
  return KNOWN[action] ?? action;
}

export async function getCustomerTimeline(customerId: string): Promise<TimelineEntry[]> {
  const [agreements, jobs, maintenanceRequests, notes] = await Promise.all([
    prisma.rentalAgreement.findMany({ where: { customerId }, select: { id: true } }),
    prisma.job.findMany({ where: { customerId }, select: { id: true } }),
    prisma.maintenanceRequest.findMany({ where: { customerId }, select: { id: true } }),
    prisma.customerNote.findMany({
      where: { customerId },
      include: { author: { select: { name: true, email: true } } },
      orderBy: [{ createdAt: "desc" }],
    }),
  ]);

  const entityFilters = [
    { entityType: "Customer", entityId: customerId },
    ...agreements.map((a) => ({ entityType: "RentalAgreement", entityId: a.id })),
    ...jobs.map((j) => ({ entityType: "Job", entityId: j.id })),
    ...maintenanceRequests.map((r) => ({ entityType: "MaintenanceRequest", entityId: r.id })),
  ];

  const auditEntries =
    entityFilters.length > 0
      ? await prisma.auditLog.findMany({
          where: { OR: entityFilters },
          include: { user: { select: { name: true, email: true } } },
          orderBy: [{ createdAt: "desc" }],
          take: 100,
        })
      : [];

  const noteEntries: TimelineEntry[] = notes.map((n) => ({
    id: `note-${n.id}`,
    kind: "note",
    summary: "Note",
    detail: n.body,
    authorName: n.author ? (n.author.name ?? n.author.email) : null,
    createdAt: n.createdAt,
  }));

  const activityEntries: TimelineEntry[] = auditEntries.map((entry) => ({
    id: `audit-${entry.id}`,
    kind: "activity",
    summary: summarizeAuditAction(entry.action),
    detail: null,
    authorName: entry.user ? (entry.user.name ?? entry.user.email) : null,
    createdAt: entry.createdAt,
  }));

  return [...noteEntries, ...activityEntries]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 100);
}

export async function addCustomerNote(
  customerId: string,
  authorId: string,
  body: string,
): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error("A note can't be empty.");
  }
  await prisma.customerNote.create({
    data: { customerId, authorId, body: trimmed },
  });
}

export async function getCustomerContacts(customerId: string) {
  return prisma.customerContact.findMany({
    where: { customerId },
    orderBy: [{ createdAt: "asc" }],
  });
}

export type NewCustomerContactInput = {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  notes?: string;
};

export async function addCustomerContact(
  customerId: string,
  input: NewCustomerContactInput,
): Promise<void> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("A contact needs at least a name.");
  }
  await prisma.customerContact.create({
    data: {
      customerId,
      name,
      role: input.role?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  });
}

export async function deleteCustomerContact(customerId: string, contactId: string): Promise<void> {
  // Scoped to customerId too, not just the contact's own id — belt and
  // suspenders against a stale/tampered form ever deleting a different
  // customer's contact.
  await prisma.customerContact.deleteMany({ where: { id: contactId, customerId } });
}
