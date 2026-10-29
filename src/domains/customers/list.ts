/**
 * CU-1 (AR-4c, CUSTOMERS spec section 4): the Customers list query over the
 * customer_list_v1 view. Roles are filtered at the query boundary: the STAFF
 * select literally omits the money columns (monthlyRentCents, owedCents,
 * pastDueCents, autopay), the owes segment and the money sorts are refused
 * for staff (falling back to the defaults), and staff row objects never
 * carry the money keys.
 *
 * Paging follows the KIT 5.1 cursor rule (same shape as the Rentals list):
 * the window grows from the start through the cursor row plus the next
 * page, capped at 500 rows; the cursor carries the sort value + id.
 *
 * "Past due" is a reading-query fact, never a view fact: pastDueCents is a
 * LATERAL sum over open invoices due before the Denver start of today.
 */
import { Prisma, type InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { payPathFor } from "@/domains/billing/bill-status";
import { requireRole } from "@/lib/session";
import { formatShortDate } from "@/lib/business-date";
import { jobTypeLabel } from "@/lib/status-labels";
import { getRentalEndingNoticeDays } from "@/domains/agreements/ending-notice";
import {
  customerSegments,
  endingWindowEnd,
  segmentWhereSql,
  startOfTodayDenver,
  type CustomerSegment,
} from "./segments";

export const CUSTOMER_SORTS = [
  "attention",
  "name",
  "rent-desc",
  "owed-desc",
  "newest",
  "since",
] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export type CustomerListParams = {
  segment?: CustomerSegment | "all";
  q?: string;
  city?: string[];
  /** Property managers only. */
  pm?: boolean;
  autopay?: "off";
  /** Has an open service request. */
  service?: boolean;
  /** Appliance type ids on current (unassigned, ACTIVE-agreement) assignments. */
  appliance?: string[];
  /** Customer-since lower bound (yyyy-mm-dd). */
  since?: string;
  sort?: CustomerSort;
  cursor?: string;
  /** Rows per window growth step (default 50, KIT 5.1); tests shrink it. */
  pageSize?: number;
};

export type CustomerListRow = {
  id: string;
  /** Display name: company name for businesses, else the person's name. */
  name: string;
  companyName: string | null;
  isPropertyManager: boolean;
  email: string;
  phone: string | null;
  city: string | null;
  propertyCount: number;
  activeCount: number;
  pendingCount: number;
  endedCount: number;
  monthlyRentCents?: number;
  owedCents?: number;
  pastDueCents?: number;
  autopay?: boolean;
  /** The Take payment target (oldest open bill), OWNER/ADMIN rows only. */
  oldestOpenBillId?: string | null;
  oldestOpenBillPayPath?: "STRIPE_LINK" | "SHOP_CARD" | "MANUAL_ONLY" | null;
  nextVisitAt: Date | null;
  nextVisitType: string | null;
  nextVisitDurationMinutes: number | null;
  nextBillOn: Date | null;
  endingOn: Date | null;
  pickupAt: Date | null;
  createdAt: Date;
  segments: CustomerSegment[];
};

const PAGE_SIZE = 50;
const WINDOW_CAP = 500;
const OPEN_MAINTENANCE = ["SUBMITTED", "REVIEWING", "SCHEDULED", "IN_PROGRESS"];

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

/** The shared filter fragments (everything except the segment itself). */
function filtersSql(p: CustomerListParams, staff: boolean): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`1 = 1`];
  const q = p.q?.trim().slice(0, 80) ?? "";
  if (q.length >= 2) {
    const digits = q.replace(/\D/g, "");
    const like = `%${q}%`;
    const asset = Prisma.sql`EXISTS (
      SELECT 1 FROM "ApplianceAssignment" aa
      JOIN "RentalLine" rl ON rl."id" = aa."rentalLineId"
      JOIN "RentalAgreement" ra ON ra."id" = rl."agreementId"
      JOIN "Appliance" ap ON ap."id" = aa."applianceId"
      WHERE ra."customerId" = c."id" AND aa."unassignedAt" IS NULL
        AND ra."status" = 'ACTIVE' AND ap."assetNumber" ILIKE ${q})`;
    if (digits.length >= 4) {
      parts.push(Prisma.sql`(c."phoneDigits" LIKE ${`%${digits}%`} OR ${asset})`);
    } else {
      parts.push(Prisma.sql`(u."name" ILIKE ${like} OR lower(u."email") ILIKE ${`%${q.toLowerCase()}%`}
        OR c."companyName" ILIKE ${like}
        OR EXISTS (SELECT 1 FROM "ServiceAddress" sa WHERE sa."customerId" = c."id"
          AND (sa."line1" ILIKE ${like} OR sa."city" ILIKE ${like}))
        OR ${asset})`);
    }
  }
  if (p.city?.length) {
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "ServiceAddress" sc
      WHERE sc."customerId" = c."id" AND sc."city" IN (${Prisma.join(p.city)}))`);
  }
  if (p.pm) parts.push(Prisma.sql`c."isPropertyManager" = true`);
  if (p.autopay === "off" && !staff)
    parts.push(Prisma.sql`v."autopay" = false`);
  if (p.service) {
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "MaintenanceRequest" mr
      WHERE mr."customerId" = c."id" AND mr."status" IN (${Prisma.join(OPEN_MAINTENANCE)}))`);
  }
  if (p.appliance?.length) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ApplianceAssignment" aa
      JOIN "RentalLine" rl ON rl."id" = aa."rentalLineId"
      JOIN "RentalAgreement" ra ON ra."id" = rl."agreementId"
      JOIN "Appliance" ap ON ap."id" = aa."applianceId"
      WHERE ra."customerId" = c."id" AND aa."unassignedAt" IS NULL
        AND ra."status" = 'ACTIVE' AND ap."applianceTypeId" IN (${Prisma.join(p.appliance)}))`);
  }
  if (p.since && /^\d{4}-\d{2}-\d{2}$/.test(p.since)) {
    parts.push(Prisma.sql`c."createdAt" >= ${new Date(`${p.since}T00:00:00.000Z`)}`);
  }
  return Prisma.join(parts, " AND ");
}

function segmentSql(
  p: CustomerListParams,
  startToday: Date,
  windowEnd: Date,
): Prisma.Sql {
  const segment = p.segment ?? "active";
  if (segment === "all") return Prisma.sql`1 = 1`;
  return segmentWhereSql(segment, "v", startToday, windowEnd);
}

function sortSql(sort: CustomerSort, startToday: Date, windowEnd: Date): Prisma.Sql {
  switch (sort) {
    case "name":
      return Prisma.sql`ORDER BY lower(COALESCE(c."companyName", u."name", u."email")) ASC, v."id" ASC`;
    case "rent-desc":
      return Prisma.sql`ORDER BY v."monthlyRentCents" DESC, lower(COALESCE(c."companyName", u."name", u."email")) ASC, v."id" ASC`;
    case "owed-desc":
      return Prisma.sql`ORDER BY v."owedCents" DESC, lower(COALESCE(c."companyName", u."name", u."email")) ASC, v."id" ASC`;
    case "newest":
      return Prisma.sql`ORDER BY c."createdAt" DESC, v."id" DESC`;
    case "since":
      return Prisma.sql`ORDER BY c."createdAt" ASC, v."id" ASC`;
    case "attention":
      return Prisma.sql`ORDER BY
        CASE
          WHEN v."oldestOpenDueDate" < ${startToday} THEN 0
          WHEN v."endingOn" < ${windowEnd} OR v."pickupAt" < ${windowEnd} THEN 1
          WHEN v."pendingCount" > 0 AND v."activeCount" = 0 THEN 2
          ELSE 3
        END ASC,
        v."oldestOpenDueDate" ASC NULLS LAST,
        COALESCE(v."endingOn", v."pickupAt") ASC NULLS LAST,
        lower(COALESCE(c."companyName", u."name", u."email")) ASC,
        v."id" ASC`;
  }
}

function sortValueOf(sort: CustomerSort, r: RawRow, startToday: Date, windowEnd: Date): string | number | null {
  switch (sort) {
    case "name":
      return (r.companyName ?? r.userName ?? r.userEmail).toLowerCase();
    case "rent-desc":
      return r.monthlyRentCents ?? 0;
    case "owed-desc":
      return r.owedCents ?? 0;
    case "newest":
    case "since":
      return r.createdAt.toISOString();
    case "attention": {
      const rank =
        r.oldestOpenDueDate !== null && r.oldestOpenDueDate < startToday
          ? 0
          : (r.endingOn !== null && r.endingOn < windowEnd) ||
              (r.pickupAt !== null && r.pickupAt < windowEnd)
            ? 1
            : r.pendingCount > 0 && r.activeCount === 0
              ? 2
              : 3;
      return rank;
    }
  }
}

type RawRow = {
  id: string;
  userName: string | null;
  userEmail: string;
  companyName: string | null;
  isPropertyManager: boolean;
  phone: string | null;
  createdAt: Date;
  activeCount: number;
  pendingCount: number;
  endedCount: number;
  monthlyRentCents: number | null;
  owedCents: number | null;
  pastDueCents: number | null;
  autopay: boolean | null;
  oldestOpenDueDate: Date | null;
  nextVisitAt: Date | null;
  nextVisitType: string | null;
  nextVisitDurationMinutes: number | null;
  nextBillOn: Date | null;
  endingOn: Date | null;
  pickupAt: Date | null;
  propertyCount: number;
  city: string | null;
  obId: string | null;
  obStatus: string | null;
  obOwed: number | null;
  obStripe: string | null;
  obSale: string | null;
};

const BASE_FROM = Prisma.sql`
  FROM "customer_list_v1" v
  JOIN "Customer" c ON c."id" = v."id"
  JOIN "User" u ON u."id" = c."userId"`;

/** The next visit's duration (for the "Delivery Tue 9–11" window text) — not money, so every role gets it. */
function nextJobLateral(): Prisma.Sql {
  return Prisma.sql`LEFT JOIN LATERAL (
    SELECT j."durationMinutes" AS "nextVisitDurationMinutes"
    FROM "Job" j
    WHERE j."customerId" = v."id" AND j."status" IN ('SCHEDULED', 'IN_PROGRESS')
      AND j."scheduledAt" = v."nextVisitAt" AND j."type" = v."nextVisitType"
    ORDER BY j."id" ASC LIMIT 1
  ) nj ON true`;
}

/** The oldest open bill (the record page's Take payment target) — money-adjacent, owner/admin only. */
function oldestBillLateral(): Prisma.Sql {
  return Prisma.sql`LEFT JOIN LATERAL (
    SELECT i."id" AS "obId", i."status"::text AS "obStatus",
      GREATEST(i."amountDueCents" - i."amountPaidCents", 0)::int AS "obOwed",
      i."stripeInvoiceId" AS "obStripe", i."saleKind" AS "obSale"
    FROM "Invoice" i
    WHERE i."customerId" = v."id"
      AND i."status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED')
      AND i."amountDueCents" > i."amountPaidCents"
    ORDER BY i."dueDate" ASC NULLS LAST, i."createdAt" ASC
    LIMIT 1
  ) ob ON true`;
}

function pastDueLateral(startToday: Date): Prisma.Sql {
  return Prisma.sql`LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(GREATEST(0, inv."amountDueCents" - inv."amountPaidCents")), 0)::int AS "pastDueCents"
    FROM "Invoice" inv
    WHERE inv."customerId" = v."id"
      AND inv."status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED')
      AND inv."amountDueCents" > inv."amountPaidCents"
      AND inv."dueDate" < ${startToday}
  ) pd ON true`;
}

async function fetchRows(
  where: Prisma.Sql,
  sort: CustomerSort,
  staff: boolean,
  startToday: Date,
  windowEnd: Date,
): Promise<RawRow[]> {
  const money = staff
    ? Prisma.sql`NULL::int AS "monthlyRentCents", NULL::int AS "owedCents",
        NULL::int AS "pastDueCents", NULL::boolean AS "autopay"`
    : Prisma.sql`v."monthlyRentCents", v."owedCents", pd."pastDueCents", v."autopay"`;
  const order = sortSql(sort, startToday, windowEnd);
  return prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT v."id", u."name" AS "userName", u."email" AS "userEmail",
      c."companyName", c."isPropertyManager", c."phone", c."createdAt",
      v."activeCount", v."pendingCount", v."endedCount",
      ${money},
      v."oldestOpenDueDate", v."nextVisitAt", v."nextVisitType",
      nj."nextVisitDurationMinutes",
      v."nextBillOn", v."endingOn", v."pickupAt", v."propertyCount", v."city",
      ob."obId", ob."obStatus", ob."obOwed", ob."obStripe", ob."obSale"
    ${BASE_FROM}
    ${nextJobLateral()}
    ${staff ? Prisma.sql`LEFT JOIN LATERAL (SELECT NULL::int AS "pastDueCents") pd ON true` : pastDueLateral(startToday)}
    ${staff ? Prisma.sql`LEFT JOIN LATERAL (SELECT NULL::text AS "obId", NULL::text AS "obStatus", NULL::int AS "obOwed", NULL::text AS "obStripe", NULL::text AS "obSale") ob ON true` : oldestBillLateral()}
    WHERE ${where}
    ${order}`);
}

export async function getCustomerList(
  p: CustomerListParams,
  now = new Date(),
): Promise<{ rows: CustomerListRow[]; nextCursor: string | null; capped: boolean }> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const staff = session.user.role === "STAFF";
  const endingDays = await getRentalEndingNoticeDays();
  const startToday = startOfTodayDenver(now);
  const windowEnd = endingWindowEnd(now, endingDays);

  // Staff refusals fall back to the defaults (spec section 4).
  const segment: CustomerListParams["segment"] =
    staff && p.segment === "owes" ? "active" : (p.segment ?? "active");
  const sort: CustomerSort =
    staff && (p.sort === "rent-desc" || p.sort === "owed-desc")
      ? "attention"
      : (p.sort ?? "attention");

  const where = Prisma.sql`${filtersSql(p, staff)} AND ${segmentSql({ ...p, segment }, startToday, windowEnd)}`;
  const all = await fetchRows(where, sort, staff, startToday, windowEnd);

  const ordered: CursorValue[] = all.map((r) => ({
    v: sortValueOf(sort, r, startToday, windowEnd),
    id: r.id,
  }));
  const cursor = decodeCursor(p.cursor);
  const through = cursor ? ordered.findIndex((o) => o.id === cursor.id) + 1 : 0;
  const windowValues = ordered.slice(
    0,
    Math.min(through + (p.pageSize ?? PAGE_SIZE), WINDOW_CAP),
  );
  const capped = windowValues.length >= WINDOW_CAP && ordered.length > windowValues.length;
  const hasMore = !capped && ordered.length > windowValues.length;
  const nextCursor = hasMore
    ? encodeCursor(windowValues[windowValues.length - 1])
    : null;

  const byId = new Map(all.map((r) => [r.id, r]));
  const rows: CustomerListRow[] = windowValues.map((w) => {
    const r = byId.get(w.id)!;
    const row: CustomerListRow = {
      id: r.id,
      name: r.companyName ?? r.userName ?? r.userEmail,
      companyName: r.companyName,
      isPropertyManager: r.isPropertyManager,
      email: r.userEmail,
      phone: r.phone,
      city: r.city,
      propertyCount: r.propertyCount,
      activeCount: r.activeCount,
      pendingCount: r.pendingCount,
      endedCount: r.endedCount,
      nextVisitAt: r.nextVisitAt,
      nextVisitType: r.nextVisitType,
      nextVisitDurationMinutes: r.nextVisitDurationMinutes,
      nextBillOn: r.nextBillOn,
      endingOn: r.endingOn,
      pickupAt: r.pickupAt,
      createdAt: r.createdAt,
      segments: customerSegments(r, now, endingDays),
    };
    if (!staff) {
      row.monthlyRentCents = r.monthlyRentCents ?? 0;
      row.owedCents = r.owedCents ?? 0;
      row.pastDueCents = r.pastDueCents ?? 0;
      row.autopay = r.autopay ?? false;
      row.oldestOpenBillId = r.obId;
      row.oldestOpenBillPayPath = r.obId
        ? payPathFor({
            status: r.obStatus as InvoiceStatus,
            owedCents: r.obOwed ?? 0,
            stripeInvoiceId: r.obStripe,
            saleKind: r.obSale,
          })
        : null;
    }
    return row;
  });
  return { rows, nextCursor, capped };
}

/** The CSV export read: same filters as the list, no window cap, max 10,000 rows. OWNER/ADMIN only. With `ids`, exports exactly that selection. */
export async function getCustomerExportRows(
  p: Omit<CustomerListParams, "cursor" | "pageSize"> & { ids?: string[] },
  now = new Date(),
): Promise<CustomerListRow[]> {
  const session = await requireRole("OWNER", "ADMIN");
  void session;
  const endingDays = await getRentalEndingNoticeDays();
  const startToday = startOfTodayDenver(now);
  const windowEnd = endingWindowEnd(now, endingDays);
  const sort: CustomerSort = p.sort ?? "attention";
  const where =
    p.ids && p.ids.length > 0
      ? Prisma.sql`v."id" IN (${Prisma.join(p.ids.slice(0, 500))})`
      : Prisma.sql`${filtersSql(p, false)} AND ${segmentSql(p, startToday, windowEnd)}`;
  const all = await fetchRows(where, sort, false, startToday, windowEnd);
  return all.slice(0, 10_000).map((r) => ({
    id: r.id,
    name: r.companyName ?? r.userName ?? r.userEmail,
    companyName: r.companyName,
    isPropertyManager: r.isPropertyManager,
    email: r.userEmail,
    phone: r.phone,
    city: r.city,
    propertyCount: r.propertyCount,
    activeCount: r.activeCount,
    pendingCount: r.pendingCount,
    endedCount: r.endedCount,
    monthlyRentCents: r.monthlyRentCents ?? 0,
    owedCents: r.owedCents ?? 0,
    pastDueCents: r.pastDueCents ?? 0,
    autopay: r.autopay ?? false,
    nextVisitAt: r.nextVisitAt,
    nextVisitType: r.nextVisitType,
    nextVisitDurationMinutes: r.nextVisitDurationMinutes,
    nextBillOn: r.nextBillOn,
    endingOn: r.endingOn,
    pickupAt: r.pickupAt,
    createdAt: r.createdAt,
    segments: customerSegments(r, now, endingDays),
  }));
}

export async function getCustomerSegmentCounts(
  p: Omit<CustomerListParams, "segment" | "sort" | "cursor">,
  now = new Date(),
): Promise<Record<CustomerSegment, number>> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const staff = session.user.role === "STAFF";
  const endingDays = await getRentalEndingNoticeDays();
  const startToday = startOfTodayDenver(now);
  const windowEnd = endingWindowEnd(now, endingDays);
  const where = filtersSql(p, staff);
  const seg = (s: CustomerSegment) =>
    segmentWhereSql(s, "v", startToday, windowEnd);
  const [row] = await prisma.$queryRaw<
    { settingUp: number; active: number; owes: number; ending: number; past: number; fresh: number }[]
  >(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE ${seg("setting-up")})::int AS "settingUp",
      COUNT(*) FILTER (WHERE ${seg("active")})::int AS "active",
      COUNT(*) FILTER (WHERE ${seg("owes")})::int AS "owes",
      COUNT(*) FILTER (WHERE ${seg("ending")})::int AS "ending",
      COUNT(*) FILTER (WHERE ${seg("past")})::int AS "past",
      COUNT(*) FILTER (WHERE ${seg("new")})::int AS "fresh"
    ${BASE_FROM}
    WHERE ${where}`);
  return {
    "setting-up": row?.settingUp ?? 0,
    active: row?.active ?? 0,
    owes: staff ? 0 : (row?.owes ?? 0),
    ending: row?.ending ?? 0,
    past: row?.past ?? 0,
    new: row?.fresh ?? 0,
  };
}

/**
 * The row's next event in the spec's words — the soonest of visit, bill,
 * ending, pickup. Pure: (row, now) only.
 */
export function nextEventText(
  row: Pick<
    CustomerListRow,
    "nextVisitAt" | "nextVisitType" | "nextBillOn" | "endingOn" | "pickupAt"
  > & { nextVisitDurationMinutes?: number | null },
  now = new Date(),
): string {
  const candidates: { at: Date; text: string }[] = [];
  if (row.nextVisitAt && row.nextVisitType) {
    const at = row.nextVisitAt;
    const label = jobTypeLabel(row.nextVisitType);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Denver",
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(at);
    const weekday = parts.find((x) => x.type === "weekday")?.value ?? "";
    const startHour = Number(parts.find((x) => x.type === "hour")?.value ?? 0);
    const minutes = row.nextVisitDurationMinutes ?? 120;
    const endHour = startHour + Math.round(minutes / 60);
    candidates.push({ at, text: `${label} ${weekday} ${startHour}–${endHour}` });
  }
  if (row.nextBillOn)
    candidates.push({ at: row.nextBillOn, text: `Bill due ${formatShortDate(row.nextBillOn, now)}` });
  if (row.endingOn)
    candidates.push({ at: row.endingOn, text: `Ends ${formatShortDate(row.endingOn, now)}` });
  if (row.pickupAt)
    candidates.push({ at: row.pickupAt, text: `Pickup ${formatShortDate(row.pickupAt, now)}` });
  if (candidates.length === 0) return "—";
  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
  return candidates[0].text;
}
