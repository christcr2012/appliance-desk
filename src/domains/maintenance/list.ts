import { Prisma, type MaintenanceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

/**
 * AR-5 section 8: the Repairs list reads. Paging follows the KIT 5.1 cursor rule (same shape as
 * the Visits and Customers lists): the window grows from the start through the cursor row plus
 * the next page, capped at 500 rows; the cursor carries the sort value + id. Priority sorting
 * rides the enum's declaration order (LOW < NORMAL < HIGH < URGENT in the schema), so URGENT
 * first is priority descending.
 */
export type RepairTab = "open" | "new" | "fixed" | "closed";
export type RepairSort = "newest" | "oldest" | "priority";

export type RepairListParams = {
  tab: RepairTab;
  priority?: "URGENT" | "HIGH";
  q?: string;
  sort: RepairSort;
  cursor?: string;
  /** Rows per window growth step (default 50, KIT 5.1); tests shrink it. */
  pageSize?: number;
};

export type RepairRow = {
  id: string;
  status: MaintenanceStatus;
  priority: string;
  openedAt: Date;
  /** The problem's first 120 characters. */
  problemExcerpt: string;
  customerName: string;
  applianceLabel: string | null;
  nextVisit: { id: string; scheduledAt: Date } | null;
  hasOpenVisit: boolean;
};

const PAGE_SIZE = 50;
const WINDOW_CAP = 500;
const OPEN_STATUSES: MaintenanceStatus[] = ["SUBMITTED", "REVIEWING", "SCHEDULED", "IN_PROGRESS"];
const ACTIVE_VISIT = ["SCHEDULED", "IN_PROGRESS"] as const;

type CursorValue = { v: string | number | null; id: string };

function encodeCursor(c: CursorValue): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(raw: string | undefined): CursorValue | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (parsed && typeof parsed.id === "string") return parsed as CursorValue;
  } catch {
    /* an unreadable cursor just starts from the top */
  }
  return null;
}

function tabWhere(tab: RepairTab): Prisma.MaintenanceRequestWhereInput {
  switch (tab) {
    case "open":
      return { status: { in: OPEN_STATUSES } };
    case "new":
      return { status: "SUBMITTED" };
    case "fixed":
      return { status: "RESOLVED" };
    case "closed":
      return { status: "CLOSED" };
  }
}

function filtersWhere(params: RepairListParams): Prisma.MaintenanceRequestWhereInput {
  const parts: Prisma.MaintenanceRequestWhereInput[] = [];
  if (params.priority) parts.push({ priority: params.priority });
  if (params.q) {
    const q = params.q;
    parts.push({
      OR: [
        { customer: { user: { name: { contains: q, mode: "insensitive" } } } },
        { customer: { user: { email: { contains: q, mode: "insensitive" } } } },
        { problem: { contains: q, mode: "insensitive" } },
        { appliance: { assetNumber: q } },
      ],
    });
  }
  return parts.length ? { AND: parts } : {};
}

const ROW_SELECT = {
  id: true,
  status: true,
  priority: true,
  openedAt: true,
  problem: true,
  customer: { select: { user: { select: { name: true, email: true } } } },
  appliance: { select: { assetNumber: true, applianceType: { select: { name: true } } } },
  jobs: {
    where: { status: { in: [...ACTIVE_VISIT] } },
    select: { id: true, scheduledAt: true },
    orderBy: [{ scheduledAt: "asc" }],
    take: 5,
  },
};

type RawRow = Prisma.MaintenanceRequestGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(raw: RawRow): RepairRow {
  const nextVisit =
    raw.jobs
      .filter((job) => job.scheduledAt !== null)
      .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())[0] ?? null;
  return {
    id: raw.id,
    status: raw.status,
    priority: raw.priority,
    openedAt: raw.openedAt,
    problemExcerpt: raw.problem.slice(0, 120),
    customerName: raw.customer.user.name ?? raw.customer.user.email,
    applianceLabel: raw.appliance
      ? `${raw.appliance.applianceType.name} #${raw.appliance.assetNumber}`
      : null,
    nextVisit: nextVisit ? { id: nextVisit.id, scheduledAt: nextVisit.scheduledAt! } : null,
    hasOpenVisit: raw.jobs.length > 0,
  };
}

export async function getRepairRequests(
  params: RepairListParams,
): Promise<{ rows: RepairRow[]; nextCursor: string | null; capped: boolean }> {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const where: Prisma.MaintenanceRequestWhereInput = {
    AND: [tabWhere(params.tab), filtersWhere(params)],
  };
  const orderBy: Prisma.MaintenanceRequestOrderByWithRelationInput[] =
    params.sort === "priority"
      ? [{ priority: "desc" }, { openedAt: "desc" }, { id: "desc" }]
      : params.sort === "oldest"
        ? [{ openedAt: "asc" }, { id: "asc" }]
        : [{ openedAt: "desc" }, { id: "desc" }];

  const ordered = await prisma.maintenanceRequest.findMany({
    where,
    select: { id: true, openedAt: true },
    orderBy,
  });
  const pageSize = params.pageSize ?? PAGE_SIZE;
  const cursor = decodeCursor(params.cursor);
  const through = cursor ? ordered.findIndex((row) => row.id === cursor.id) + 1 : 0;
  const windowEnd = Math.min(through + pageSize, WINDOW_CAP);
  const windowIds = ordered.slice(0, windowEnd).map((row) => row.id);
  const capped = windowEnd >= WINDOW_CAP && ordered.length > windowEnd;
  const hasMore = ordered.length > windowIds.length;

  const rawRows = windowIds.length
    ? await prisma.maintenanceRequest.findMany({ where: { id: { in: windowIds } }, select: ROW_SELECT })
    : [];
  const byId = new Map(rawRows.map((row) => [row.id, row]));
  const rows = windowIds
    .map((id) => byId.get(id))
    .filter((row): row is RawRow => Boolean(row))
    .map(toRow);

  const last = ordered[windowIds.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ v: last.openedAt.toISOString(), id: last.id })
      : null;
  return { rows, nextCursor, capped };
}

/** StatusTabs counts: every tab counted with the same non-tab filters applied. */
export async function getRepairCounts(
  params: RepairListParams,
): Promise<Record<RepairTab, number>> {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const tabs: RepairTab[] = ["open", "new", "fixed", "closed"];
  const counts = await Promise.all(
    tabs.map((tab) =>
      prisma.maintenanceRequest.count({
        where: { AND: [tabWhere(tab), filtersWhere(params)] },
      }),
    ),
  );
  return { open: counts[0]!, new: counts[1]!, fixed: counts[2]!, closed: counts[3]! };
}
