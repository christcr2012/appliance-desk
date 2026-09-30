import type { Prisma, LeadStatus } from "@prisma/client";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { parsePage, paginationMeta } from "@/domains/pagination";

export const LEAD_VIEWS = ["all", "awaiting-reply", "no-next-task"] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];
export function leadFilters(query: {
  status?: string;
  view?: string;
  q?: string;
  page?: string;
}) {
  const status = ["NEW", "CONTACTED", "CONVERTED", "LOST"].includes(
    query.status ?? "",
  )
    ? (query.status as LeadStatus)
    : undefined;
  const view = LEAD_VIEWS.find((v) => v === query.view) ?? "all";
  return {
    status,
    view,
    q: query.q?.trim().slice(0, 100) ?? "",
    page: parsePage(query.page),
  };
}
export function leadWorkspaceWhere(
  filter: ReturnType<typeof leadFilters>,
): Prisma.LeadWhereInput {
  return {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.q
      ? {
          OR: ["contactName", "companyName", "email", "phone", "city"].map(
            (field) => ({
              [field]: { contains: filter.q, mode: "insensitive" },
            }),
          ),
        }
      : {}),
    ...(filter.view === "awaiting-reply"
      ? { estimates: { some: { status: { in: ["SENT", "VIEWED"] } } } }
      : {}),
    ...(filter.view === "no-next-task"
      ? {
          tasks: { none: { completedAt: null } },
          ...(filter.status ? {} : { status: { in: ["NEW", "CONTACTED"] } }),
        }
      : {}),
  };
}
export async function getLeadWorkspace(
  query: Parameters<typeof leadFilters>[0],
) {
  await requireRole("OWNER", "ADMIN");
  const filter = leadFilters(query);
  const where = leadWorkspaceWhere(filter);
  const meta = paginationMeta(await prisma.lead.count({ where }), filter.page);
  const records = await prisma.lead.findMany({
    where,
    take: meta.pageSize,
    skip: meta.skip,
    orderBy: [{ score: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      contactName: true,
      companyName: true,
      city: true,
      phone: true,
      status: true,
      score: true,
      isHighValue: true,
      howHeard: true,
      createdAt: true,
      updatedAt: true,
      applianceRequests: {
        select: { quantity: true, applianceType: { select: { name: true } } },
      },
      notesLog: {
        select: { createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      },
      tasks: {
        where: { completedAt: null },
        select: { id: true, dueDate: true },
        orderBy: [
          { dueDate: { sort: "asc", nulls: "last" } },
          { createdAt: "asc" },
          { id: "asc" },
        ],
        take: 1,
      },
      estimates: {
        where: { status: { in: ["SENT", "VIEWED"] } },
        select: { id: true, estimateNumber: true, status: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      },
    },
  });
  return { records, filter, ...meta };
}
export async function getLeadEstimates(leadId: string) {
  await requireRole("OWNER", "ADMIN");
  return prisma.estimate.findMany({
    where: { leadId },
    select: { id: true, estimateNumber: true, status: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 26,
  });
}
