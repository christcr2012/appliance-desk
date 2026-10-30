import { Prisma, type EstimateStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

/**
 * AR-4d (QUOTES-MESSAGES spec section 2): the paged quotes read that replaces
 * getAllEstimates() on the list page. Quotes are OWNER/ADMIN end to end, so
 * both reads carry the role check themselves (the PR #594 pattern: the guard
 * lives in the domain, not the layout).
 *
 * Paging follows the KIT 5.1 cursor rule (same shape as the Customers and
 * Rentals lists): the window grows from the start through the cursor row
 * plus the next page, capped at 500 rows; the cursor carries the sort
 * value + id.
 */

export const QUOTE_TABS = ["open", "approved", "won", "closed", "drafts"] as const;
export type QuoteTab = (typeof QUOTE_TABS)[number];

export const QUOTE_TAB_STATUSES: Record<QuoteTab, EstimateStatus[]> = {
  open: ["DRAFT", "SENT", "VIEWED", "CHANGES_REQUESTED"],
  approved: ["APPROVED"],
  won: ["CONVERTED"],
  closed: ["DECLINED", "EXPIRED"],
  drafts: ["DRAFT"],
};

export const QUOTE_SORTS = ["newest", "oldest-sent", "value-desc", "expires"] as const;
export type QuoteSort = (typeof QUOTE_SORTS)[number];

export type QuoteListParams = {
  tab?: QuoteTab;
  /** Name, company, or quote-number digits. */
  q?: string;
  /** A quote counts as a lead quote until it has a customer (leadId stays set after conversion). */
  who?: "customers" | "leads";
  sort?: QuoteSort;
  cursor?: string;
  /** Rows per window growth step (default 50, KIT 5.1); tests shrink it. */
  pageSize?: number;
};

export type QuoteListRow = {
  id: string;
  estimateNumber: number;
  status: EstimateStatus;
  title: string;
  sentAt: Date | null;
  viewedAt: Date | null;
  respondedAt: Date | null;
  validUntil: Date | null;
  createdAt: Date;
  depositCents: number;
  customer: { id: string; name: string | null; company: string | null } | null;
  lead: { id: string; contactName: string; company: string | null } | null;
  /** Follow-up contact for the row's person (customer first, else lead). */
  contactPhone: string | null;
  contactEmail: string | null;
  monthlyCents: number;
  oneTimeCents: number;
};

const PAGE_SIZE = 50;
const WINDOW_CAP = 500;

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

/** The shared filters: everything except the tab's own status set. */
async function filtersWhere(p: QuoteListParams): Promise<Prisma.EstimateWhereInput> {
  const where: Prisma.EstimateWhereInput = {};
  if (p.who === "customers") where.customerId = { not: null };
  if (p.who === "leads") {
    where.customerId = null;
    where.leadId = { not: null };
  }
  const q = p.q?.trim().slice(0, 80) ?? "";
  const or: Prisma.EstimateWhereInput[] = [];
  if (q.length >= 2) {
    or.push(
      { customer: { user: { name: { contains: q, mode: "insensitive" } } } },
      { customer: { companyName: { contains: q, mode: "insensitive" } } },
      { lead: { contactName: { contains: q, mode: "insensitive" } } },
      { lead: { companyName: { contains: q, mode: "insensitive" } } },
    );
  }
  // A bare number is a quote-number search (the spec's "quote number
  // digits"): a contains match at any length — typing 12 finds #112, #120
  // and #123, and a fresh book's numbers are only a digit or two long.
  // estimateNumber is an Int, so the digit match runs as a raw id lookup.
  if (/^\d+$/.test(q)) {
    const hits = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Estimate" WHERE CAST("estimateNumber" AS TEXT) LIKE ${`%${q}%`}`;
    or.push({ id: { in: hits.map((h) => h.id) } });
  }
  if (or.length) where.OR = or;
  return where;
}

type LightRow = {
  id: string;
  estimateNumber: number;
  status: EstimateStatus;
  title: string;
  sentAt: Date | null;
  viewedAt: Date | null;
  respondedAt: Date | null;
  validUntil: Date | null;
  createdAt: Date;
  depositCents: number;
  customer: {
    id: string;
    companyName: string | null;
    user: { name: string | null; phone: string | null; email: string };
  } | null;
  lead: { id: string; contactName: string; companyName: string | null; phone: string; email: string | null } | null;
  monthlyCents: number;
  oneTimeCents: number;
};

/** One query for the whole set's money sums (never per row). The sums use the
 * same price × quantity math as totalMonthlyCents/totalOneTimeCents. */
async function sumsFor(ids: string[]): Promise<Map<string, { m: number; o: number }>> {
  const out = new Map<string, { m: number; o: number }>();
  if (ids.length === 0) return out;
  const rows = await prisma.$queryRaw<Array<{ estimateId: string; m: bigint; o: bigint }>>`
    SELECT "estimateId",
           SUM("monthlyPriceCents" * "quantity")::bigint AS m,
           SUM("oneTimeFeeCents" * "quantity")::bigint AS o
    FROM "EstimateLineItem"
    WHERE "estimateId" IN (${Prisma.join(ids)})
    GROUP BY "estimateId"`;
  for (const r of rows) out.set(r.estimateId, { m: Number(r.m), o: Number(r.o) });
  return out;
}

function sortValueOf(sort: QuoteSort, r: LightRow): number | null {
  switch (sort) {
    case "newest":
      return r.createdAt.getTime();
    case "oldest-sent":
      return r.sentAt ? r.sentAt.getTime() : null;
    case "value-desc":
      return r.monthlyCents;
    case "expires":
      return r.validUntil ? r.validUntil.getTime() : null;
  }
}

function compareRows(sort: QuoteSort, a: LightRow, b: LightRow): number {
  const byId = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  switch (sort) {
    case "newest":
      return b.createdAt.getTime() - a.createdAt.getTime() || -byId;
    case "oldest-sent": {
      // Waiting longest first; never-sent quotes (drafts) wait at the end.
      const av = a.sentAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const bv = b.sentAt?.getTime() ?? Number.POSITIVE_INFINITY;
      return av - bv || a.createdAt.getTime() - b.createdAt.getTime() || byId;
    }
    case "value-desc":
      return (
        b.monthlyCents - a.monthlyCents ||
        b.oneTimeCents - a.oneTimeCents ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        -byId
      );
    case "expires": {
      const av = a.validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
      const bv = b.validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
      return av - bv || b.createdAt.getTime() - a.createdAt.getTime() || -byId;
    }
  }
}

export async function getQuotes(
  params: QuoteListParams = {},
): Promise<{ rows: QuoteListRow[]; nextCursor: string | null; capped: boolean }> {
  await requireRole("OWNER", "ADMIN");
  const tab = params.tab ?? "open";
  const sort = params.sort ?? "newest";
  const where: Prisma.EstimateWhereInput = {
    ...(await filtersWhere(params)),
    status: { in: QUOTE_TAB_STATUSES[tab] },
  };
  const found = await prisma.estimate.findMany({
    where,
    select: {
      id: true,
      estimateNumber: true,
      status: true,
      title: true,
      sentAt: true,
      viewedAt: true,
      respondedAt: true,
      validUntil: true,
      createdAt: true,
      depositCents: true,
      customer: {
        select: {
          id: true,
          companyName: true,
          user: { select: { name: true, phone: true, email: true } },
        },
      },
      lead: { select: { id: true, contactName: true, companyName: true, phone: true, email: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const sums = await sumsFor(found.map((r) => r.id));
  const all: LightRow[] = found.map((r) => ({
    ...r,
    monthlyCents: sums.get(r.id)?.m ?? 0,
    oneTimeCents: sums.get(r.id)?.o ?? 0,
  }));
  all.sort((a, b) => compareRows(sort, a, b));

  const ordered: CursorValue[] = all.map((r) => ({ v: sortValueOf(sort, r), id: r.id }));
  const cursor = decodeCursor(params.cursor);
  const through = cursor ? ordered.findIndex((o) => o.id === cursor.id) + 1 : 0;
  const windowValues = ordered.slice(
    0,
    Math.min(through + (params.pageSize ?? PAGE_SIZE), WINDOW_CAP),
  );
  const capped = windowValues.length >= WINDOW_CAP && ordered.length > windowValues.length;
  const hasMore = !capped && ordered.length > windowValues.length;
  const nextCursor = hasMore
    ? encodeCursor(windowValues[windowValues.length - 1])
    : null;

  const byId = new Map(all.map((r) => [r.id, r]));
  const rows: QuoteListRow[] = windowValues.map((w) => {
    const r = byId.get(w.id)!;
    return {
      id: r.id,
      estimateNumber: r.estimateNumber,
      status: r.status,
      title: r.title,
      sentAt: r.sentAt,
      viewedAt: r.viewedAt,
      respondedAt: r.respondedAt,
      validUntil: r.validUntil,
      createdAt: r.createdAt,
      depositCents: r.depositCents,
      customer: r.customer
        ? { id: r.customer.id, name: r.customer.user.name, company: r.customer.companyName }
        : null,
      lead: r.lead
        ? { id: r.lead.id, contactName: r.lead.contactName, company: r.lead.companyName }
        : null,
      contactPhone: r.customer?.user.phone ?? r.lead?.phone ?? null,
      contactEmail: r.customer?.user.email ?? r.lead?.email ?? null,
      monthlyCents: r.monthlyCents,
      oneTimeCents: r.oneTimeCents,
    };
  });
  return { rows, nextCursor, capped };
}

/** Tab counts for the same search/filter (the tab itself is not a filter here). */
export async function getQuoteCounts(
  params: QuoteListParams = {},
): Promise<Record<QuoteTab, number>> {
  await requireRole("OWNER", "ADMIN");
  const base = await filtersWhere(params);
  const entries = await Promise.all(
    QUOTE_TABS.map(async (tab) => {
      const n = await prisma.estimate.count({
        where: { ...base, status: { in: QUOTE_TAB_STATUSES[tab] } },
      });
      return [tab, n] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<QuoteTab, number>;
}
