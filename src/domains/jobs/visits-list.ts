import { Prisma, type JobStatus, type JobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { businessWeekStart } from "@/lib/business-date";
import { JOB_OPERATIONAL_SELECT } from "./index";

/**
 * AR-5 section 4: the Visits list reads. Paging follows the KIT 5.1 cursor rule (same shape as the
 * Customers and Rentals lists): the window grows from the start through the cursor row plus the
 * next page, capped at 500 rows; the cursor carries the sort value + id, and the id tie-breaks so
 * rows with identical timestamps cannot shift or repeat across pages.
 *
 * Roles are filtered here, at the query boundary: every read requires a team session, and only
 * JOB_OPERATIONAL_SELECT fields are selected (no money). The `who` filter is an OWNER/ADMIN
 * control (the Board rule in section 3): for STAFF it is ignored — the list is the shared
 * read-only calendar for them; what a staff member may WORK is enforced by assertJobScopeInTx on
 * writes, never by hiding rows here.
 */
export type VisitTab = "upcoming" | "no-time" | "done" | "cancelled";
export type VisitSort = "soonest" | "latest";
export type VisitWhen = "this-week" | "next-week" | "last-30";

export type VisitListParams = {
  tab: VisitTab;
  type?: JobType;
  /** everyone | mine | unassigned | a team member id (OWNER/ADMIN only). */
  who?: string;
  q?: string;
  when?: VisitWhen;
  sort: VisitSort;
  cursor?: string;
  /** Rows per window growth step (default 50, KIT 5.1); tests shrink it. */
  pageSize?: number;
};

export type VisitRow = Prisma.JobGetPayload<{ select: typeof JOB_OPERATIONAL_SELECT }>;

const PAGE_SIZE = 50;
const WINDOW_CAP = 500;
const DAY = 86_400_000;

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

const ACTIVE: JobStatus[] = ["SCHEDULED", "IN_PROGRESS"];

/** The sort field each tab orders by; the direction comes from the tab default or the sort param. */
const SORT_FIELD: Record<VisitTab, "scheduledAt" | "createdAt" | "completedAt" | "updatedAt"> = {
  upcoming: "scheduledAt",
  "no-time": "createdAt",
  done: "completedAt",
  cancelled: "updatedAt",
};

function tabWhere(tab: VisitTab): Prisma.JobWhereInput {
  switch (tab) {
    case "upcoming":
      return { status: { in: ACTIVE }, scheduledAt: { not: null } };
    case "no-time":
      return { status: { in: ACTIVE }, scheduledAt: null };
    case "done":
      return { status: "COMPLETED" };
    case "cancelled":
      return { status: "CANCELLED" };
  }
}

function whenRange(when: VisitWhen, now: Date): { gte: Date; lt?: Date } {
  if (when === "last-30") return { gte: new Date(now.getTime() - 30 * DAY), lt: undefined };
  const start = businessWeekStart(now);
  if (when === "this-week") return { gte: start, lt: new Date(start.getTime() + 7 * DAY) };
  const next = new Date(start.getTime() + 7 * DAY);
  return { gte: next, lt: new Date(next.getTime() + 7 * DAY) };
}

/** Everything except the tab itself: type, who, search, and the date preset (on the tab's sort field). */
function filtersWhere(
  params: VisitListParams,
  actor: { id: string; role: string },
  now: Date,
): Prisma.JobWhereInput {
  const parts: Prisma.JobWhereInput[] = [];
  if (params.type) parts.push({ type: params.type });
  if (params.who && (actor.role === "OWNER" || actor.role === "ADMIN")) {
    if (params.who === "mine") parts.push({ assignedToUserId: actor.id });
    else if (params.who === "unassigned") parts.push({ assignedToUserId: null });
    else if (params.who !== "everyone") parts.push({ assignedToUserId: params.who });
  }
  if (params.q) {
    const q = params.q;
    parts.push({
      OR: [
        { customer: { user: { name: { contains: q, mode: "insensitive" } } } },
        { customer: { user: { email: { contains: q, mode: "insensitive" } } } },
        { serviceAddress: { line1: { contains: q, mode: "insensitive" } } },
        { appliances: { some: { appliance: { assetNumber: q } } } },
      ],
    });
  }
  if (params.when) {
    const range = whenRange(params.when, now);
    parts.push({ [SORT_FIELD[params.tab]]: range });
  }
  return parts.length ? { AND: parts } : {};
}

export async function getVisits(
  params: VisitListParams,
  now: Date = new Date(),
): Promise<{ rows: VisitRow[]; nextCursor: string | null; capped: boolean }> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const actor = { id: session.user.id, role: session.user.role };
  const field = SORT_FIELD[params.tab];
  const dir = params.sort === "latest" ? "desc" : "asc";
  const where: Prisma.JobWhereInput = {
    AND: [tabWhere(params.tab), filtersWhere(params, actor, now)],
  };

  const ordered = await prisma.job.findMany({
    where,
    select: { id: true, scheduledAt: true, createdAt: true, completedAt: true, updatedAt: true },
    orderBy: [{ [field]: dir }, { id: dir }],
  });
  const pageSize = params.pageSize ?? PAGE_SIZE;
  const cursor = decodeCursor(params.cursor);
  const through = cursor ? ordered.findIndex((row) => row.id === cursor.id) + 1 : 0;
  const windowEnd = Math.min(through + pageSize, WINDOW_CAP);
  const windowIds = ordered.slice(0, windowEnd).map((row) => row.id);
  const capped = windowEnd >= WINDOW_CAP && ordered.length > windowEnd;
  const hasMore = ordered.length > windowIds.length;

  const rows = windowIds.length
    ? await prisma.job.findMany({
        where: { id: { in: windowIds } },
        select: JOB_OPERATIONAL_SELECT,
      })
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const sorted = windowIds
    .map((id) => byId.get(id))
    .filter((row): row is VisitRow => Boolean(row));

  const last = ordered[windowIds.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ v: (last[field] as Date | null)?.toISOString() ?? null, id: last.id })
      : null;
  return { rows: sorted, nextCursor, capped };
}

/** StatusTabs counts: every tab counted with the same non-tab filters applied. */
export async function getVisitCounts(
  params: VisitListParams,
  now: Date = new Date(),
): Promise<Record<VisitTab, number>> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const actor = { id: session.user.id, role: session.user.role };
  const tabs: VisitTab[] = ["upcoming", "no-time", "done", "cancelled"];
  const counts = await Promise.all(
    tabs.map((tab) =>
      prisma.job.count({
        where: { AND: [tabWhere(tab), filtersWhere({ ...params, tab }, actor, now)] },
      }),
    ),
  );
  return {
    upcoming: counts[0]!,
    "no-time": counts[1]!,
    done: counts[2]!,
    cancelled: counts[3]!,
  };
}
