import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  businessDateEnd,
  businessDateKey,
  businessDayBounds,
  businessEndOfDay,
  businessMonthBounds,
  businessWeekStart,
} from "@/lib/business-date";
import { leadStage, leadStageWhere, type LeadStage } from "./stage";
import { summarizeApplianceRequests } from "./requests";

/**
 * LD-1: the leads work queue (used by screens/LEADS.md, AR-4b). One function
 * per sort family: "next-up" ranks in one SQL ORDER BY (design section 5),
 * "value" sorts by the newest open quote's monthly total, and the rest use
 * plain Prisma ordering with the KIT 5.1 cursor rule (page size 50, cap 500;
 * "Load more" grows the window). Merged leads never appear.
 *
 * The `owner` filter takes a user id, or "unassigned". The screen token "me"
 * is resolved to the signed-in user's id by the caller (the desk page knows
 * the session); a literal "me" here is refused rather than silently matching
 * nothing.
 */
export type LeadDatePreset = "today" | "week" | "month";
export type LeadQueueSort = "next-up" | "newest" | "score" | "value" | "activity";
export type LeadQueueParams = {
  stage?: LeadStage;
  q?: string;
  owner?: "me" | "unassigned" | string;
  source?: string[];
  area?: "in" | "out";
  highValue?: boolean;
  appliance?: string[];
  created?: LeadDatePreset;
  hasQuote?: boolean;
  follow?: "today" | "week";
  sort: LeadQueueSort;
  cursor?: string;
};

export type LeadRow = {
  id: string;
  contactName: string;
  companyName: string | null;
  city: string | null;
  isBusiness: boolean;
  isPropertyManager: boolean;
  isHighValue: boolean;
  score: number;
  scoreReasons: string[];
  stage: LeadStage;
  assignedTo: { id: string; name: string; initials: string } | null;
  phone: string;
  email: string | null;
  nextFollowUpOn: Date | null;
  createdAt: Date;
  firstContactedAt: Date | null;
  applianceSummary: string;
  desiredTerm: string | null;
  openQuote: { status: string; sentAt: Date | null; viewedAt: Date | null } | null;
  monthlyValueCents: number | null;
};

export const LEAD_QUEUE_PAGE_SIZE = 50;
export const LEAD_QUEUE_CAP = 500;

const OPEN_QUOTE_STATUSES = ["SENT", "VIEWED"] as const;

// ---- shared filters ----

function followEnd(follow: "today" | "week", now: Date): Date {
  if (follow === "today") return businessEndOfDay(now);
  // The 7th Denver day counting today as day 1; its last whole second.
  const key = businessDateKey(now);
  const seventh = new Date(`${key}T00:00:00Z`);
  seventh.setUTCDate(seventh.getUTCDate() + 6);
  return businessDateEnd(seventh.toISOString().slice(0, 10));
}

function searchPrisma(q: string): Prisma.LeadWhereInput {
  if (/^\d+$/.test(q) && q.length >= 4) {
    return { phoneDigits: { contains: q } };
  }
  return {
    OR: [
      { contactName: { contains: q, mode: "insensitive" } },
      { companyName: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { emailLower: { startsWith: q.toLowerCase() } },
    ],
  };
}

function createdRange(preset: LeadDatePreset, now: Date): Prisma.DateTimeFilter {
  switch (preset) {
    case "today":
      return { gte: businessDayBounds(now).start };
    case "week":
      return { gte: businessWeekStart(now) };
    case "month":
      return { gte: businessMonthBounds(now).start };
  }
}

function queueWherePrisma(p: LeadQueueParams, now: Date): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [{ mergedIntoLeadId: null }];
  if (p.stage) and.push(leadStageWhere[p.stage]);
  if (p.owner === "me") {
    throw new Error("Resolve 'me' to the signed-in user's id before calling getLeadQueue.");
  }
  if (p.owner === "unassigned") and.push({ assignedToUserId: null });
  else if (p.owner) and.push({ assignedToUserId: p.owner });
  if (p.source?.length) and.push({ howHeard: { in: p.source } });
  if (p.area === "in") and.push({ inServiceArea: true });
  if (p.area === "out") and.push({ inServiceArea: false });
  if (p.highValue) and.push({ isHighValue: true });
  if (p.appliance?.length) {
    and.push({ applianceRequests: { some: { applianceTypeId: { in: p.appliance } } } });
  }
  if (p.created) and.push({ createdAt: createdRange(p.created, now) });
  if (p.hasQuote === true) {
    and.push({ estimates: { some: { status: { in: [...OPEN_QUOTE_STATUSES] } } } });
  }
  if (p.hasQuote === false) {
    and.push({ estimates: { none: { status: { in: [...OPEN_QUOTE_STATUSES] } } } });
  }
  if (p.follow) {
    // Follow-ups due, on a lead that is still open (never won or lost).
    // With follow and no stage, no default stage is applied.
    and.push({
      status: { notIn: ["CONVERTED", "LOST"] },
      nextFollowUpOn: { lte: followEnd(p.follow, now) },
    });
  }
  const q = p.q?.trim();
  if (q && q.length >= 2) and.push(searchPrisma(q));
  return { AND: and };
}

// ---- the same filters as SQL, for the "next-up" and "value" orders ----

/** Open quotes per lead, joined once: the count and the oldest sent date. */
const OPEN_QUOTES_JOIN = Prisma.sql`
  LEFT JOIN (
    SELECT "leadId", MIN("sentAt") AS "oldestSentAt", COUNT(*) AS "openCount"
    FROM "Estimate" WHERE "status" IN ('SENT', 'VIEWED') GROUP BY "leadId"
  ) oq ON oq."leadId" = l."id"`;

function stageSql(stage: LeadStage): Prisma.Sql {
  switch (stage) {
    case "new":
      return Prisma.sql`(l."status" = 'NEW' AND l."firstContactedAt" IS NULL AND oq."openCount" IS NULL)`;
    case "contacted":
      return Prisma.sql`(l."status" IN ('NEW', 'CONTACTED') AND NOT (l."status" = 'NEW' AND l."firstContactedAt" IS NULL) AND oq."openCount" IS NULL)`;
    case "quoted":
      return Prisma.sql`(l."status" IN ('NEW', 'CONTACTED') AND oq."openCount" IS NOT NULL)`;
    case "won":
      return Prisma.sql`l."status" = 'CONVERTED'`;
    case "lost":
      return Prisma.sql`l."status" = 'LOST'`;
  }
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function searchSql(q: string): Prisma.Sql {
  if (/^\d+$/.test(q) && q.length >= 4) {
    return Prisma.sql`l."phoneDigits" LIKE ${`%${q}%`}`;
  }
  const pattern = `%${likeEscape(q)}%`;
  return Prisma.sql`(l."contactName" ILIKE ${pattern} ESCAPE '\' OR l."companyName" ILIKE ${pattern} ESCAPE '\' OR l."city" ILIKE ${pattern} ESCAPE '\' OR l."emailLower" LIKE ${`${q.toLowerCase()}%`})`;
}

function queueWhereSql(p: LeadQueueParams, now: Date): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`l."mergedIntoLeadId" IS NULL`];
  if (p.stage) parts.push(stageSql(p.stage));
  if (p.owner === "me") {
    throw new Error("Resolve 'me' to the signed-in user's id before calling getLeadQueue.");
  }
  if (p.owner === "unassigned") parts.push(Prisma.sql`l."assignedToUserId" IS NULL`);
  else if (p.owner) parts.push(Prisma.sql`l."assignedToUserId" = ${p.owner}`);
  if (p.source?.length) parts.push(Prisma.sql`l."howHeard" = ANY(${p.source})`);
  if (p.area === "in") parts.push(Prisma.sql`l."inServiceArea" = TRUE`);
  if (p.area === "out") parts.push(Prisma.sql`l."inServiceArea" = FALSE`);
  if (p.highValue) parts.push(Prisma.sql`l."isHighValue" = TRUE`);
  if (p.appliance?.length) {
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "LeadApplianceRequest" r WHERE r."leadId" = l."id" AND r."applianceTypeId" = ANY(${p.appliance}))`,
    );
  }
  if (p.created) parts.push(Prisma.sql`l."createdAt" >= ${createdRange(p.created, now).gte!}`);
  if (p.hasQuote === true) parts.push(Prisma.sql`oq."openCount" IS NOT NULL`);
  if (p.hasQuote === false) parts.push(Prisma.sql`oq."openCount" IS NULL`);
  if (p.follow) {
    parts.push(
      Prisma.sql`l."status" NOT IN ('CONVERTED', 'LOST') AND l."nextFollowUpOn" <= ${followEnd(p.follow, now)}`,
    );
  }
  const q = p.q?.trim();
  if (q && q.length >= 2) parts.push(searchSql(q));
  return Prisma.join(parts, " AND ");
}

// ---- cursors (KIT 5.1): base64url JSON of the last row shown ----

type NextUpCursor = { rank: number; key: string; id: string };
type ValueCursor = { v: number | null; id: string };

function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor<T>(raw: string | undefined, check: (v: unknown) => v is T): T | null {
  if (!raw || raw.length > 400) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    return check(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const isNextUpCursor = (v: unknown): v is NextUpCursor => {
  if (!v || typeof v !== "object") return false;
  const c = v as { rank?: unknown; key?: unknown; id?: unknown };
  return (
    typeof c.rank === "number" &&
    Number.isSafeInteger(c.rank) &&
    typeof c.key === "string" &&
    typeof c.id === "string"
  );
};

const isValueCursor = (v: unknown): v is ValueCursor => {
  if (!v || typeof v !== "object") return false;
  const c = v as { v?: unknown; id?: unknown };
  return (c.v === null || typeof c.v === "number") && typeof c.id === "string";
};

// ---- row hydration ----

const ROW_SELECT = {
  id: true,
  contactName: true,
  companyName: true,
  city: true,
  isBusiness: true,
  isPropertyManager: true,
  isHighValue: true,
  score: true,
  scoreReasons: true,
  status: true,
  firstContactedAt: true,
  phone: true,
  email: true,
  nextFollowUpOn: true,
  createdAt: true,
  lastRealContactAt: true,
  desiredTerm: true,
  assignedTo: { select: { id: true, name: true, email: true } },
  applianceRequests: {
    select: {
      quantity: true,
      applianceType: { select: { name: true } },
      package: { select: { id: true, name: true } },
    },
  },
  estimates: {
    where: { status: { in: [...OPEN_QUOTE_STATUSES] } },
    select: {
      status: true,
      sentAt: true,
      viewedAt: true,
      lineItems: { select: { monthlyPriceCents: true, quantity: true } },
    },
    orderBy: [{ sentAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 1,
  },
} satisfies Prisma.LeadSelect;

type SelectedLead = Prisma.LeadGetPayload<{ select: typeof ROW_SELECT }>;

function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function toRow(lead: SelectedLead): LeadRow {
  const openQuote = lead.estimates[0] ?? null;
  return {
    id: lead.id,
    contactName: lead.contactName,
    companyName: lead.companyName,
    city: lead.city,
    isBusiness: lead.isBusiness,
    isPropertyManager: lead.isPropertyManager,
    isHighValue: lead.isHighValue,
    score: lead.score,
    scoreReasons: Array.isArray(lead.scoreReasons)
      ? lead.scoreReasons.filter((r): r is string => typeof r === "string")
      : [],
    stage: leadStage({
      status: lead.status,
      firstContactedAt: lead.firstContactedAt,
      openQuote: lead.estimates.length > 0,
    }),
    assignedTo: lead.assignedTo
      ? {
          id: lead.assignedTo.id,
          name: lead.assignedTo.name ?? lead.assignedTo.email,
          initials: nameInitials(lead.assignedTo.name ?? lead.assignedTo.email),
        }
      : null,
    phone: lead.phone,
    email: lead.email,
    nextFollowUpOn: lead.nextFollowUpOn,
    createdAt: lead.createdAt,
    firstContactedAt: lead.firstContactedAt,
    applianceSummary: summarizeApplianceRequests(lead.applianceRequests),
    desiredTerm: lead.desiredTerm,
    openQuote: openQuote
      ? { status: openQuote.status, sentAt: openQuote.sentAt, viewedAt: openQuote.viewedAt }
      : null,
    monthlyValueCents: openQuote
      ? openQuote.lineItems.reduce((sum, line) => sum + line.monthlyPriceCents * line.quantity, 0)
      : null,
  };
}

async function fetchRowsInOrder(ids: string[]): Promise<LeadRow[]> {
  if (ids.length === 0) return [];
  const found = await prisma.lead.findMany({ where: { id: { in: ids } }, select: ROW_SELECT });
  const byId = new Map(found.map((lead) => [lead.id, lead]));
  return ids.flatMap((id) => (byId.has(id) ? [toRow(byId.get(id)!)] : []));
}

// ---- "next-up" order: one SQL ORDER BY with a computed rank ----

type RankedId = { id: string; rank: number; key: string };

async function nextUpOrderedIds(p: LeadQueueParams, now: Date, limit: number): Promise<RankedId[]> {
  const { start, end } = businessDayBounds(now);
  // Rank 1 = CONTACTED with a follow-up before today (Denver), oldest first;
  // 2 = stage new, oldest created first; 3 = follow-up due today; 4 = quoted,
  // oldest open quote first; 5 = everything else by score.
  const rank = Prisma.sql`CASE
    WHEN l."status" = 'CONTACTED' AND l."nextFollowUpOn" IS NOT NULL AND l."nextFollowUpOn" < ${start} THEN 1
    WHEN l."status" = 'NEW' AND l."firstContactedAt" IS NULL AND oq."openCount" IS NULL THEN 2
    WHEN l."status" = 'CONTACTED' AND l."nextFollowUpOn" IS NOT NULL AND l."nextFollowUpOn" >= ${start} AND l."nextFollowUpOn" < ${end} THEN 3
    WHEN oq."openCount" IS NOT NULL AND l."status" IN ('NEW', 'CONTACTED') THEN 4
    ELSE 5 END`;
  // The rank is computed once per row in the innermost query; the middle
  // query derives the sort keys from that plain rank column, and the outer
  // query sorts on plain columns. (Evaluating the rank CASE once per ORDER
  // BY key — seven times per row — was the slow part on 50,000 leads.)
  return prisma.$queryRaw<RankedId[]>`
    SELECT "id", "rank", "key" FROM (
      SELECT "id", "rank",
        CASE "rank"
          WHEN 1 THEN to_char("nextFollowUpOn" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHEN 2 THEN to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHEN 3 THEN to_char("nextFollowUpOn" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHEN 4 THEN to_char("oldestSentAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          ELSE lpad("score"::text, 10, '0') END AS "key",
        CASE "rank" WHEN 1 THEN "nextFollowUpOn" WHEN 3 THEN "nextFollowUpOn" END AS "keyFollowUp",
        CASE "rank" WHEN 2 THEN "createdAt" END AS "keyCreated",
        CASE "rank" WHEN 4 THEN "oldestSentAt" END AS "keySent",
        CASE "rank" WHEN 5 THEN "score" END AS "keyScore"
      FROM (
        SELECT l."id" AS "id", ${rank} AS "rank",
          l."nextFollowUpOn" AS "nextFollowUpOn", l."createdAt" AS "createdAt",
          oq."oldestSentAt" AS "oldestSentAt", l."score" AS "score"
        FROM "Lead" l ${OPEN_QUOTES_JOIN}
        WHERE ${queueWhereSql(p, now)}
      ) ranked
    ) keyed
    ORDER BY "rank" ASC,
      "keyFollowUp" ASC NULLS LAST,
      "keyCreated" ASC NULLS LAST,
      "keySent" ASC NULLS LAST,
      "keyScore" DESC NULLS LAST,
      "id" ASC
    LIMIT ${limit}`;
}

async function getNextUpQueue(
  p: LeadQueueParams,
  now: Date,
): Promise<{ rows: LeadRow[]; nextCursor: string | null; capped: boolean }> {
  const cursor = decodeCursor(p.cursor, isNextUpCursor);
  // First page: 51 ids tell us whether another page exists. With a cursor:
  // up to the cap, so the cursor row's position can be found in the list.
  const ordered = await nextUpOrderedIds(p, now, cursor ? LEAD_QUEUE_CAP + 1 : LEAD_QUEUE_PAGE_SIZE + 1);
  const through = cursor ? ordered.findIndex((r) => r.id === cursor.id) + 1 : 0;
  const limit = Math.min(Math.max(through, 0) + LEAD_QUEUE_PAGE_SIZE, LEAD_QUEUE_CAP);
  const window = ordered.slice(0, limit);
  const more = ordered.length > limit;
  const capped = more && limit >= LEAD_QUEUE_CAP;
  const rows = await fetchRowsInOrder(window.map((r) => r.id));
  const last = window.at(-1);
  return {
    rows,
    nextCursor: more && !capped && last ? encodeCursor({ rank: last.rank, key: last.key, id: last.id }) : null,
    capped,
  };
}

// ---- "value" order: biggest monthly value of the newest open quote ----

async function getValueQueue(
  p: LeadQueueParams,
  now: Date,
): Promise<{ rows: LeadRow[]; nextCursor: string | null; capped: boolean }> {
  const cursor = decodeCursor(p.cursor, isValueCursor);
  const ordered = await prisma.$queryRaw<{ id: string; value: number }[]>`
    SELECT l."id" AS "id",
      (SELECT COALESCE(SUM(li."monthlyPriceCents" * li."quantity")::int, 0)
       FROM "EstimateLineItem" li WHERE li."estimateId" = (
         SELECT e."id" FROM "Estimate" e WHERE e."leadId" = l."id" AND e."status" IN ('SENT', 'VIEWED')
         ORDER BY e."sentAt" DESC NULLS LAST, e."createdAt" DESC LIMIT 1)) AS "value"
    FROM "Lead" l ${OPEN_QUOTES_JOIN}
    WHERE ${queueWhereSql(p, now)}
    ORDER BY "value" DESC NULLS LAST, l."id" DESC
    LIMIT ${cursor ? LEAD_QUEUE_CAP + 1 : LEAD_QUEUE_PAGE_SIZE + 1}`;
  const through = cursor ? ordered.findIndex((r) => r.id === cursor.id) + 1 : 0;
  const limit = Math.min(Math.max(through, 0) + LEAD_QUEUE_PAGE_SIZE, LEAD_QUEUE_CAP);
  const window = ordered.slice(0, limit);
  const more = ordered.length > limit;
  const capped = more && limit >= LEAD_QUEUE_CAP;
  const rows = await fetchRowsInOrder(window.map((r) => r.id));
  const last = rows.at(-1);
  return {
    rows,
    nextCursor: more && !capped && last ? encodeCursor({ v: last.monthlyValueCents, id: last.id }) : null,
    capped,
  };
}

// ---- plain Prisma orders (KIT 5.1) ----

type PrismaSort = Exclude<LeadQueueSort, "next-up" | "value">;

function orderByFor(sort: PrismaSort): Prisma.LeadOrderByWithRelationInput[] {
  switch (sort) {
    case "newest":
      return [{ createdAt: "desc" }, { id: "desc" }];
    case "score":
      return [{ score: "desc" }, { id: "desc" }];
    case "activity":
      return [{ lastRealContactAt: { sort: "desc", nulls: "last" } }, { id: "desc" }];
  }
}

type PlainCursor = { v: string | number | null; id: string };

const isPlainCursor = (v: unknown): v is PlainCursor => {
  if (!v || typeof v !== "object") return false;
  const c = v as { v?: unknown; id?: unknown };
  return (c.v === null || typeof c.v === "string" || typeof c.v === "number") && typeof c.id === "string";
};

function sortValue(sort: PrismaSort, lead: SelectedLead): string | number | null {
  if (sort === "score") return lead.score;
  if (sort === "newest") return lead.createdAt.toISOString();
  return lead.lastRealContactAt ? lead.lastRealContactAt.toISOString() : null;
}

/** Rows at or before the cursor row in this order (nulls sort last). */
function atOrBefore(sort: PrismaSort, cursor: PlainCursor): Prisma.LeadWhereInput {
  const tie = { id: { gte: cursor.id } };
  if (sort === "score") {
    if (typeof cursor.v !== "number") return { id: "" };
    return {
      OR: [{ score: { gt: cursor.v } }, { score: cursor.v, ...tie }],
    };
  }
  if (cursor.v === null) {
    if (sort !== "activity") return { id: "" };
    // The cursor row has no activity: every row with activity comes first.
    return { OR: [{ lastRealContactAt: { not: null } }, { lastRealContactAt: null, ...tie }] };
  }
  if (typeof cursor.v !== "string") return { id: "" };
  const at = new Date(cursor.v);
  if (!Number.isFinite(at.getTime())) return { id: "" };
  if (sort === "newest") {
    return { OR: [{ createdAt: { gt: at } }, { createdAt: at, ...tie }] };
  }
  return { OR: [{ lastRealContactAt: { gt: at } }, { lastRealContactAt: at, ...tie }] };
}

async function getPrismaQueue(
  p: LeadQueueParams,
  sort: PrismaSort,
  now: Date,
): Promise<{ rows: LeadRow[]; nextCursor: string | null; capped: boolean }> {
  const base = queueWherePrisma(p, now);
  const cursor = decodeCursor(p.cursor, isPlainCursor);
  const through = cursor
    ? await prisma.lead.count({ where: { AND: [base, atOrBefore(sort, cursor)] } })
    : 0;
  const limit = Math.min(through + LEAD_QUEUE_PAGE_SIZE, LEAD_QUEUE_CAP);
  const fetched = await prisma.lead.findMany({
    where: base,
    select: ROW_SELECT,
    orderBy: orderByFor(sort),
    take: limit + 1,
  });
  const shown = fetched.slice(0, limit);
  const more = fetched.length > limit;
  const capped = more && limit >= LEAD_QUEUE_CAP;
  const last = shown.at(-1);
  return {
    rows: shown.map(toRow),
    nextCursor: more && !capped && last ? encodeCursor({ v: sortValue(sort, last), id: last.id }) : null,
    capped,
  };
}

// ---- public API ----

export async function getLeadQueue(
  p: LeadQueueParams,
  now: Date,
): Promise<{ rows: LeadRow[]; nextCursor: string | null; capped: boolean }> {
  if (p.sort === "next-up") return getNextUpQueue(p, now);
  if (p.sort === "value") return getValueQueue(p, now);
  return getPrismaQueue(p, p.sort, now);
}

/** One count per stage, with the same search and filters (but no stage).
 *
 * One aggregate scan, not five `count` calls: the spec's five calls each
 * re-scan the leads and re-run the per-row open-quote check, and the `new`
 * count alone took over 500 ms on 50,000 leads. The FILTER predicates below
 * are exactly `leadStageWhere` (same stage rules, same shared filters via
 * `queueWhereSql`), so the numbers agree with the queue rows.
 */
export async function getLeadStageCounts(
  p: Omit<LeadQueueParams, "stage" | "sort" | "cursor">,
): Promise<Record<LeadStage, number>> {
  const now = new Date();
  const params = { ...p, sort: "newest" as const };
  const rows = await prisma.$queryRaw<
    { new: number; contacted: number; quoted: number; won: number; lost: number }[]
  >`
    SELECT
      COUNT(*) FILTER (WHERE l."status" = 'NEW' AND l."firstContactedAt" IS NULL AND oq."openCount" IS NULL)::int AS "new",
      COUNT(*) FILTER (WHERE l."status" IN ('NEW', 'CONTACTED') AND NOT (l."status" = 'NEW' AND l."firstContactedAt" IS NULL) AND oq."openCount" IS NULL)::int AS "contacted",
      COUNT(*) FILTER (WHERE l."status" IN ('NEW', 'CONTACTED') AND oq."openCount" IS NOT NULL)::int AS "quoted",
      COUNT(*) FILTER (WHERE l."status" = 'CONVERTED')::int AS "won",
      COUNT(*) FILTER (WHERE l."status" = 'LOST')::int AS "lost"
    FROM "Lead" l ${OPEN_QUOTES_JOIN}
    WHERE ${queueWhereSql(params, now)}`;
  const row = rows[0] ?? { new: 0, contacted: 0, quoted: 0, won: 0, lost: 0 };
  return {
    new: row.new,
    contacted: row.contacted,
    quoted: row.quoted,
    won: row.won,
    lost: row.lost,
  };
}
