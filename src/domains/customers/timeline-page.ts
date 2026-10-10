import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { summarizeAuditAction, type TimelineEntry } from "./timeline";
import { getLinkedCommunicationRows } from "@/domains/messaging/context-timeline";

export type TimelineFilter = "all" | "notes" | "activity" | "communications";
export type Cursor = { createdAt: string; id: string; kind: "note" | "activity" | "message" | "call" };
export type LinkedTimelineEntry = TimelineEntry & { href: string | null };
const PAGE_SIZE = 25;
const SOURCE_RANK = {note:0, activity:1, message:2, call:3} as const;
export function timelineFilter(value?: string): TimelineFilter {
  return value === "notes" || value === "activity" || value === "communications" ? value : "all";
}
export function readTimelineCursor(raw?: string): Cursor | null {
  if (!raw || raw.length > 512) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      (!["note", "activity", "message", "call"].includes(c.kind)) ||
      typeof c.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(c.id) ||
      typeof c.createdAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(c.createdAt) ||
      !Number.isFinite(new Date(c.createdAt).getTime())
    )
      return null;
    return {
      id: c.id,
      kind: c.kind,
      createdAt: new Date(c.createdAt).toISOString(),
    };
  } catch {
    return null;
  }
}
/** Merge uses time, source, then id. Each database stream uses the same stable order. */
export function timelineCursorWhere(
  kind: Cursor["kind"],
  cursor: Cursor | null,
) {
  if (!cursor) return {};
  const createdAt = new Date(cursor.createdAt);
  // Notes sort before activity at equal timestamps; IDs are ordered within a source.
  const equalTime =
    kind === cursor.kind
      ? { createdAt, id: { lt: cursor.id } }
      : SOURCE_RANK[kind] > SOURCE_RANK[cursor.kind]
        ? { createdAt }
        : null;
  return {
    OR: [{ createdAt: { lt: createdAt } }, ...(equalTime ? [equalTime] : [])],
  };
}
export function mergeTimelinePage(
  notes: LinkedTimelineEntry[],
  activity: LinkedTimelineEntry[],
  messages: LinkedTimelineEntry[] = [],
  calls: LinkedTimelineEntry[] = [],
) {
  const merged = [...notes, ...activity, ...messages, ...calls].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() ||
      (a.kind !== b.kind
        ? SOURCE_RANK[a.kind] - SOURCE_RANK[b.kind]
        : a.id === b.id
          ? 0
          : a.id > b.id
            ? -1
            : 1),
  );
  const entries = merged.slice(0, PAGE_SIZE);
  const last = entries.at(-1);
  const nextCursor =
    merged.length > PAGE_SIZE && last
      ? Buffer.from(
          JSON.stringify({
            createdAt: last.createdAt.toISOString(),
            kind: last.kind,
            id: last.id.slice(last.kind === "note" ? 5 : last.kind === "activity" ? 6 : last.kind === "message" ? 8 : 5),
          }),
        ).toString("base64url")
      : null;
  return { entries, nextCursor };
}
function entityHref(type: string, id: string | null): string | null {
  const prefix: Record<string, string> = {
    Customer: "/desk/customers/",
    RentalAgreement: "/desk/agreements/",
    Job: "/desk/jobs/",
    MaintenanceRequest: "/desk/maintenance/",
  };
  return id && prefix[type] ? `${prefix[type]}${encodeURIComponent(id)}` : null;
}
export async function getCustomerTimelinePage(
  customerId: string,
  filter: TimelineFilter = "all",
  rawCursor?: string,
) {
  await requireRole("OWNER", "ADMIN");
  const cursor = readTimelineCursor(rawCursor);
  const notesPromise =
    filter === "activity" || filter === "communications"
      ? Promise.resolve([])
      : prisma.customerNote.findMany({
          where: { AND: [{ customerId }, timelineCursorWhere("note", cursor)] },
          select: {
            id: true,
            body: true,
            createdAt: true,
            author: { select: { name: true, email: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: PAGE_SIZE + 1,
        });
  const activityPromise = (async () => {
    if (filter === "notes" || filter === "communications") return [];
    const [agreements, jobs, requests] = await Promise.all([
      prisma.rentalAgreement.findMany({
        where: { customerId },
        select: { id: true },
      }),
      prisma.job.findMany({ where: { customerId }, select: { id: true } }),
      prisma.maintenanceRequest.findMany({
        where: { customerId },
        select: { id: true },
      }),
    ]);
    const scope: Prisma.AuditLogWhereInput[] = [
      { entityType: "Customer", entityId: customerId },
      {
        entityType: "RentalAgreement",
        entityId: { in: agreements.map((a) => a.id) },
      },
      { entityType: "Job", entityId: { in: jobs.map((j) => j.id) } },
      {
        entityType: "MaintenanceRequest",
        entityId: { in: requests.map((r) => r.id) },
      },
    ];
    return prisma.auditLog.findMany({
      where: { AND: [{ OR: scope }, timelineCursorWhere("activity", cursor)] },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
    });
  })();
  const commPromise = filter === "notes" || filter === "activity" ? Promise.resolve({messages:[],calls:[]}) : getLinkedCommunicationRows("Customer", customerId, cursor);
  const [notes, activity, comm] = await Promise.all([notesPromise, activityPromise, commPromise]);
  return mergeTimelinePage(
    notes.map((n) => ({
      id: `note-${n.id}`,
      kind: "note",
      summary: "Internal note",
      detail: n.body,
      authorName: n.author ? (n.author.name ?? n.author.email) : null,
      createdAt: n.createdAt,
      href: null,
    })),
    activity.map((a) => ({
      id: `audit-${a.id}`,
      kind: "activity",
      summary: summarizeAuditAction(a.action),
      detail: null,
      authorName: a.user ? (a.user.name ?? a.user.email) : null,
      createdAt: a.createdAt,
      href: entityHref(a.entityType, a.entityId),
    })),
    comm.messages,
    comm.calls,
  );
}
