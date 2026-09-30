import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getBusinessSettings } from "@/domains/settings";

// ---------------------------------------------------------------------------
// A single, printable work order — the field-ready version of a Job,
// matching the brand kit's Work-order.pdf template the same way
// invoice-detail.ts's InvoiceDetail matches Invoice.pdf (2026-09-29,
// flagged in docs/ROADMAP.md's "Ideas surfaced researching Jobber + the
// brand kit" entry, built once the estimates work wrapped up). Staff-only
// — there's no customer-facing version of a Job, so this has no
// customer-scoping option the way getInvoiceDetail does.
//
// Deliberately leaves out money: partsCostCents/laborCostCents are
// Chris's own internal repair-cost bookkeeping (feeds appliance
// profitability, see docs/DATABASE.md), not something a work order
// handed to whoever's doing the visit needs to show.
// ---------------------------------------------------------------------------

export type WorkOrderDetail = {
  id: string;
  type: string;
  status: string;
  scheduledAt: Date | null;
  completedAt: Date | null;
  notes: string | null;
  completionNotes: string | null;
  checklist: { item: string; checked: boolean }[];
  createdAt: Date;
  customer: {
    name: string;
    phone: string | null;
    email: string;
  } | null;
  address: string | null;
  appliances: {
    id: string;
    applianceType: string;
    assetNumber: string;
  }[];
  business: {
    name: string;
    phone: string;
    email: string;
    address: string;
    logoUrl: string | null;
  };
};

function addressLabel(
  a: { line1: string; line2: string | null; city: string; state: string; zip: string } | null,
): string | null {
  if (!a) return null;
  return `${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.city}, ${a.state} ${a.zip}`;
}

export async function getWorkOrderDetail(jobId: string): Promise<WorkOrderDetail | null> {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const [job, settings] = await Promise.all([
    prisma.job.findUnique({
      where: { id: jobId },
      include: {
        customer: { select: { phone: true, user: { select: { name: true, email: true } } } },
        serviceAddress: true,
        appliances: {
          include: { appliance: { include: { applianceType: true } } },
        },
      },
    }),
    getBusinessSettings(),
  ]);

  if (!job) return null;

  const checklist = Array.isArray(job.checklist)
    ? (job.checklist as { item: string; checked: boolean }[])
    : [];

  return {
    id: job.id,
    type: job.type,
    status: job.status,
    scheduledAt: job.scheduledAt,
    completedAt: job.completedAt,
    notes: job.notes,
    completionNotes: job.completionNotes,
    checklist,
    createdAt: job.createdAt,
    customer: job.customer
      ? {
          name: job.customer.user.name ?? job.customer.user.email,
          phone: job.customer.phone,
          email: job.customer.user.email,
        }
      : null,
    address: addressLabel(job.serviceAddress),
    appliances: job.appliances.map((ja) => ({
      id: ja.appliance.id,
      applianceType: ja.appliance.applianceType.name,
      assetNumber: ja.appliance.assetNumber,
    })),
    business: {
      name: settings.publicBusinessName,
      phone: settings.publicPhone,
      email: settings.publicEmail,
      address: settings.publicAddress,
      logoUrl: settings.logoUrl,
    },
  };
}

