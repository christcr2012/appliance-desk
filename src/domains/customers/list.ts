/**
 * CU-1 (AR-4c, CUSTOMERS spec section 4): the Customers list query. Roles
 * are filtered at the query boundary: the STAFF select literally omits the
 * money columns (monthlyRentCents, owedCents, pastDueCents, autopay), the
 * owes segment and the money sorts are refused for staff (falling back to
 * the defaults), and staff row objects never carry the money keys.
 *
 * CU1-PERF (the AR-4c follow-up): the reads no longer touch the
 * customer_list_v1 view, whose six per-customer LATERAL aggregates ran for
 * every live customer on every call (~1.5 s at the 20,000-customer capacity
 * seed against the 150 ms budget). A list call now runs in phases over the
 * base tables: fetchOrderedIds resolves the full ordering as ids only
 * (candidates from base-table filters + the segment's EXISTS form; the
 * aggregate sort keys are grouped aggregates over the candidates alone),
 * fetchFactsByIds reads the grouped-aggregate facts for the window's ids,
 * and hydrateWindow adds the facts only a shown row needs (next visit,
 * property count, city, past-due sum, oldest open bill). Segment counts
 * still run one grouped-aggregate pass over the population.
 *
 * Paging follows the KIT 5.1 cursor rule (same shape as the Rentals list):
 * the window grows from the start through the cursor row plus the next
 * page, capped at 500 rows; the cursor carries the sort value + id.
 *
 * "Past due" is a reading-query fact, never a stored fact: pastDueCents is
 * a LATERAL sum over open invoices due before the Denver start of today,
 * computed for window rows only.
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
  segmentExistsSql,
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
    // One OR group over every searchable field: a mixed query ("Perf … 19999")
    // is a name search that happens to contain digits, so the phone-digits
    // branch ADDS to the text branches instead of replacing them.
    const phone =
      digits.length >= 4
        ? Prisma.sql` OR c."phoneDigits" LIKE ${`%${digits}%`}`
        : Prisma.empty;
    parts.push(Prisma.sql`(u."name" ILIKE ${like} OR lower(u."email") ILIKE ${`%${q.toLowerCase()}%`}
      OR c."companyName" ILIKE ${like}
      OR EXISTS (SELECT 1 FROM "ServiceAddress" sa WHERE sa."customerId" = c."id"
        AND (sa."line1" ILIKE ${like} OR sa."city" ILIKE ${like}))${phone}
      OR ${asset})`);
  }
  if (p.city?.length) {
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "ServiceAddress" sc
      WHERE sc."customerId" = c."id" AND sc."city" IN (${Prisma.join(p.city)}))`);
  }
  if (p.pm) parts.push(Prisma.sql`c."isPropertyManager" = true`);
  if (p.autopay === "off" && !staff)
    parts.push(Prisma.sql`c."stripeDefaultPaymentMethodId" IS NULL`);
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

/** The tab filter: the segment as EXISTS probes over the base tables
 * (segments.ts), against the phase-A query's Customer alias "c". */
function segmentSql(
  p: CustomerListParams,
  startToday: Date,
  windowEnd: Date,
): Prisma.Sql {
  const segment = p.segment ?? "active";
  if (segment === "all") return Prisma.sql`1 = 1`;
  return segmentExistsSql(segment, startToday, windowEnd);
}

/**
 * Phase A (CU1-PERF): the full ordering as ids only. Candidates come from
 * the base tables — population, filters and the segment's EXISTS form.
 * The aggregate sort keys (rent, owed, the attention facts) join as plain
 * grouped aggregates; when the call carries a search (`scoped`), the same
 * aggregates are instead computed over the candidate set alone via a CTE
 * (search indexes narrow candidates to a handful, and paying a full
 * population aggregate pass for a one-row answer measured 15x slower).
 * A call never materializes more than the id list here; the window's wide
 * rows are fetched by id afterwards (fetchFactsByIds + hydrateWindow).
 */
async function fetchOrderedIds(
  where: Prisma.Sql,
  sort: CustomerSort,
  startToday: Date,
  windowEnd: Date,
  scoped: boolean,
): Promise<string[]> {
  const nameKey = Prisma.sql`lower(COALESCE(c."companyName", u."name", u."email"))`;
  const baseFrom = Prisma.sql`
    FROM "Customer" c
    JOIN "User" u ON u."id" = c."userId"`;
  const population = Prisma.sql`c."archivedAt" IS NULL AND NOT c."isWalkIn"`;
  if (!scoped) {
    let joins = Prisma.empty;
    let order: Prisma.Sql;
    switch (sort) {
      case "name":
        order = Prisma.sql`ORDER BY ${nameKey} ASC, c."id" ASC`;
        break;
      case "newest":
        order = Prisma.sql`ORDER BY c."createdAt" DESC, c."id" DESC`;
        break;
      case "since":
        order = Prisma.sql`ORDER BY c."createdAt" ASC, c."id" ASC`;
        break;
      case "rent-desc":
        joins = Prisma.sql`
          LEFT JOIN (
            SELECT ra2."customerId" AS "cid",
              COALESCE(SUM(rl."monthlyPriceCents"), 0)::int AS "monthlyRentCents"
            FROM "RentalLine" rl
            JOIN "RentalAgreement" ra2 ON ra2."id" = rl."agreementId"
            WHERE ra2."status" = 'ACTIVE'
            GROUP BY ra2."customerId"
          ) r ON r."cid" = c."id"`;
        order = Prisma.sql`ORDER BY COALESCE(r."monthlyRentCents", 0) DESC, ${nameKey} ASC, c."id" ASC`;
        break;
      case "owed-desc":
        // PB-FIX-1: order by the trigger-maintained Customer.owedCents
        // (migration 20261219000000_customer_owed_total) instead of
        // re-aggregating every open invoice per call — the investigation
        // measured that aggregate as the one sort cost that breaks its
        // budget by book growth alone. The stored total is defined as
        // exactly the aggregate it replaces (0 with no open invoices),
        // so ordering and tie-breaks are unchanged.
        order = Prisma.sql`ORDER BY c."owedCents" DESC, ${nameKey} ASC, c."id" ASC`;
        break;
      case "attention":
        joins = Prisma.sql`
          LEFT JOIN (
            SELECT ra."customerId" AS "cid",
              COUNT(*) FILTER (WHERE ra."status" = 'ACTIVE') AS "activeCount",
              COUNT(*) FILTER (
                WHERE ra."status" IN ('DRAFT', 'AWAITING_SIGNATURE', 'SCHEDULED')
                  OR (ra."status" = 'ACTIVE' AND ra."firstDeliveredOn" IS NULL)
              ) AS "pendingCount",
              MIN(ra."endDate") FILTER (
                WHERE ra."status" = 'ACTIVE' AND ra."termMonths" IS NOT NULL
                  AND ra."terminationRequestedAt" IS NULL
              ) AS "endingOn"
            FROM "RentalAgreement" ra
            GROUP BY ra."customerId"
          ) a ON a."cid" = c."id"
          LEFT JOIN (
            SELECT inv."customerId" AS "cid",
              MIN(inv."dueDate") FILTER (WHERE inv."amountDueCents" > inv."amountPaidCents") AS "oldestOpenDueDate"
            FROM "Invoice" inv
            WHERE inv."status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED')
            GROUP BY inv."customerId"
          ) i ON i."cid" = c."id"
          LEFT JOIN (
            SELECT j2."customerId" AS "cid", MIN(j2."scheduledAt") AS "pickupAt"
            FROM "Job" j2
            WHERE j2."type" = 'REMOVAL' AND j2."status" = 'SCHEDULED'
            GROUP BY j2."customerId"
          ) p ON p."cid" = c."id"`;
        order = Prisma.sql`ORDER BY
          CASE
            WHEN i."oldestOpenDueDate" < ${startToday} THEN 0
            WHEN a."endingOn" < ${windowEnd} OR p."pickupAt" < ${windowEnd} THEN 1
            WHEN COALESCE(a."pendingCount", 0) > 0 AND COALESCE(a."activeCount", 0) = 0 THEN 2
            ELSE 3
          END ASC,
          i."oldestOpenDueDate" ASC NULLS LAST,
          COALESCE(a."endingOn", p."pickupAt") ASC NULLS LAST,
          ${nameKey} ASC,
          c."id" ASC`;
        break;
    }
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT c."id" AS "id"
      ${baseFrom}
      ${joins}
      WHERE ${population} AND ${where}
      ${order}`);
    return rows.map((r) => r.id);
  }
  const cand = Prisma.sql`
    SELECT c."id" AS "id",
      lower(COALESCE(c."companyName", u."name", u."email")) AS "nameKey",
      c."createdAt" AS "createdAt"
    ${baseFrom}
    WHERE ${population} AND ${where}`;
  let joins = Prisma.empty;
  let order: Prisma.Sql;
  switch (sort) {
    case "name":
      order = Prisma.sql`ORDER BY cand."nameKey" ASC, cand."id" ASC`;
      break;
    case "newest":
      order = Prisma.sql`ORDER BY cand."createdAt" DESC, cand."id" DESC`;
      break;
    case "since":
      order = Prisma.sql`ORDER BY cand."createdAt" ASC, cand."id" ASC`;
      break;
    case "rent-desc":
      joins = Prisma.sql`
        LEFT JOIN (
          SELECT ra2."customerId" AS "cid",
            COALESCE(SUM(rl."monthlyPriceCents"), 0)::int AS "monthlyRentCents"
          FROM "RentalLine" rl
          JOIN "RentalAgreement" ra2 ON ra2."id" = rl."agreementId"
          WHERE ra2."status" = 'ACTIVE'
            AND ra2."customerId" IN (SELECT "id" FROM cand)
          GROUP BY ra2."customerId"
        ) r ON r."cid" = cand."id"`;
      order = Prisma.sql`ORDER BY COALESCE(r."monthlyRentCents", 0) DESC, cand."nameKey" ASC, cand."id" ASC`;
      break;
    case "owed-desc":
      joins = Prisma.sql`
        LEFT JOIN (
          SELECT inv."customerId" AS "cid",
            COALESCE(SUM(GREATEST(0, inv."amountDueCents" - inv."amountPaidCents")), 0)::int AS "owedCents"
          FROM "Invoice" inv
          WHERE inv."status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED')
            AND inv."customerId" IN (SELECT "id" FROM cand)
          GROUP BY inv."customerId"
        ) i ON i."cid" = cand."id"`;
      order = Prisma.sql`ORDER BY COALESCE(i."owedCents", 0) DESC, cand."nameKey" ASC, cand."id" ASC`;
      break;
    case "attention":
      joins = Prisma.sql`
        LEFT JOIN (
          SELECT ra."customerId" AS "cid",
            COUNT(*) FILTER (WHERE ra."status" = 'ACTIVE') AS "activeCount",
            COUNT(*) FILTER (
              WHERE ra."status" IN ('DRAFT', 'AWAITING_SIGNATURE', 'SCHEDULED')
                OR (ra."status" = 'ACTIVE' AND ra."firstDeliveredOn" IS NULL)
            ) AS "pendingCount",
            MIN(ra."endDate") FILTER (
              WHERE ra."status" = 'ACTIVE' AND ra."termMonths" IS NOT NULL
                AND ra."terminationRequestedAt" IS NULL
            ) AS "endingOn"
          FROM "RentalAgreement" ra
          WHERE ra."customerId" IN (SELECT "id" FROM cand)
          GROUP BY ra."customerId"
        ) a ON a."cid" = cand."id"
        LEFT JOIN (
          SELECT inv."customerId" AS "cid",
            MIN(inv."dueDate") FILTER (WHERE inv."amountDueCents" > inv."amountPaidCents") AS "oldestOpenDueDate"
          FROM "Invoice" inv
          WHERE inv."status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED')
            AND inv."customerId" IN (SELECT "id" FROM cand)
          GROUP BY inv."customerId"
        ) i ON i."cid" = cand."id"
        LEFT JOIN (
          SELECT j2."customerId" AS "cid", MIN(j2."scheduledAt") AS "pickupAt"
          FROM "Job" j2
          WHERE j2."type" = 'REMOVAL' AND j2."status" = 'SCHEDULED'
            AND j2."customerId" IN (SELECT "id" FROM cand)
          GROUP BY j2."customerId"
        ) p ON p."cid" = cand."id"`;
      order = Prisma.sql`ORDER BY
        CASE
          WHEN i."oldestOpenDueDate" < ${startToday} THEN 0
          WHEN a."endingOn" < ${windowEnd} OR p."pickupAt" < ${windowEnd} THEN 1
          WHEN COALESCE(a."pendingCount", 0) > 0 AND COALESCE(a."activeCount", 0) = 0 THEN 2
          ELSE 3
        END ASC,
        i."oldestOpenDueDate" ASC NULLS LAST,
        COALESCE(a."endingOn", p."pickupAt") ASC NULLS LAST,
        cand."nameKey" ASC,
        cand."id" ASC`;
      break;
  }
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH cand AS (${cand})
    SELECT cand."id" AS "id"
    FROM cand
    ${joins}
    ${order}`);
  return rows.map((r) => r.id);
}

function sortValueOf(sort: CustomerSort, r: FactsRow, startToday: Date, windowEnd: Date): string | number | null {
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

/** The facts phase row: base-table columns + the grouped-aggregate facts
 * the filters, segments and sorts read. Everything display-only lives in
 * Hydration and is fetched for window rows only. */
type FactsRow = {
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
  autopay: boolean | null;
  oldestOpenDueDate: Date | null;
  nextBillOn: Date | null;
  endingOn: Date | null;
  pickupAt: Date | null;
};

type RawRow = FactsRow & Hydration;

/**
 * The facts source (alias "v", the same column names the view exposed, so
 * the segment SQL fragments are untouched): one row per live customer
 * (archived and the walk-in counter-sale customer excluded — the view's
 * population), with the per-customer facts computed as grouped aggregates
 * over the base tables instead of per-row LATERAL probes. The FILTER
 * clauses are the view's, verbatim. With `ids`, every aggregate is scoped
 * to those customers (window rows only — index probes, not full passes);
 * without, it is the whole population (the segment-counts query).
 */
function factsFromSql(ids: string[] | null): Prisma.Sql {
  const inIds = ids ? Prisma.join(ids) : null;
  const childScope = (alias: string): Prisma.Sql =>
    inIds
      ? Prisma.sql`AND ${Prisma.raw(`"${alias}"`)}."customerId" IN (${inIds})`
      : Prisma.empty;
  const populationScope = inIds
    ? Prisma.sql`AND c0."id" IN (${inIds})`
    : Prisma.empty;
  return Prisma.sql`
  FROM (
    SELECT c0."id" AS "id",
      COALESCE(a."activeCount", 0)::int AS "activeCount",
      COALESCE(a."pendingCount", 0)::int AS "pendingCount",
      COALESCE(a."endedCount", 0)::int AS "endedCount",
      COALESCE(r."monthlyRentCents", 0)::int AS "monthlyRentCents",
      a."nextBillOn" AS "nextBillOn",
      a."endingOn" AS "endingOn",
      COALESCE(i."owedCents", 0)::int AS "owedCents",
      i."oldestOpenDueDate" AS "oldestOpenDueDate",
      p."pickupAt" AS "pickupAt",
      (c0."stripeDefaultPaymentMethodId" IS NOT NULL) AS "autopay"
    FROM "Customer" c0
    LEFT JOIN (
      SELECT ra."customerId",
        COUNT(*) FILTER (WHERE ra."status" = 'ACTIVE') AS "activeCount",
        COUNT(*) FILTER (
          WHERE ra."status" IN ('DRAFT', 'AWAITING_SIGNATURE', 'SCHEDULED')
            OR (ra."status" = 'ACTIVE' AND ra."firstDeliveredOn" IS NULL)
        ) AS "pendingCount",
        COUNT(*) FILTER (WHERE ra."status" = 'ENDED') AS "endedCount",
        MIN(ra."nextBillingDate") FILTER (WHERE ra."status" = 'ACTIVE') AS "nextBillOn",
        MIN(ra."endDate") FILTER (
          WHERE ra."status" = 'ACTIVE' AND ra."termMonths" IS NOT NULL
            AND ra."terminationRequestedAt" IS NULL
        ) AS "endingOn"
      FROM "RentalAgreement" ra
      WHERE 1 = 1 ${childScope("ra")}
      GROUP BY ra."customerId"
    ) a ON a."customerId" = c0."id"
    LEFT JOIN (
      SELECT ra2."customerId",
        COALESCE(SUM(rl."monthlyPriceCents"), 0) AS "monthlyRentCents"
      FROM "RentalLine" rl
      JOIN "RentalAgreement" ra2 ON ra2."id" = rl."agreementId"
      WHERE ra2."status" = 'ACTIVE' ${childScope("ra2")}
      GROUP BY ra2."customerId"
    ) r ON r."customerId" = c0."id"
    LEFT JOIN (
      SELECT inv."customerId",
        COALESCE(SUM(GREATEST(0, inv."amountDueCents" - inv."amountPaidCents")), 0) AS "owedCents",
        MIN(inv."dueDate") FILTER (WHERE inv."amountDueCents" > inv."amountPaidCents") AS "oldestOpenDueDate"
      FROM "Invoice" inv
      WHERE inv."status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED') ${childScope("inv")}
      GROUP BY inv."customerId"
    ) i ON i."customerId" = c0."id"
    LEFT JOIN (
      SELECT j2."customerId", MIN(j2."scheduledAt") AS "pickupAt"
      FROM "Job" j2
      WHERE j2."type" = 'REMOVAL' AND j2."status" = 'SCHEDULED' ${childScope("j2")}
      GROUP BY j2."customerId"
    ) p ON p."customerId" = c0."id"
    WHERE c0."archivedAt" IS NULL AND NOT c0."isWalkIn" ${populationScope}
  ) v
  JOIN "Customer" c ON c."id" = v."id"
  JOIN "User" u ON u."id" = c."userId"`;
}

const FACTS_FROM = factsFromSql(null);

/** Phase B (CU1-PERF): the facts for a set of ids — at most a window's
 * worth (callers chunk). Every aggregate is scoped to the ids, so this is
 * index probes, not population passes. Staff selects NULL money, exactly
 * as the old view query did. */
async function fetchFactsByIds(
  ids: string[],
  staff: boolean,
): Promise<FactsRow[]> {
  if (ids.length === 0) return [];
  const money = staff
    ? Prisma.sql`NULL::int AS "monthlyRentCents", NULL::int AS "owedCents",
        NULL::boolean AS "autopay"`
    : Prisma.sql`v."monthlyRentCents", v."owedCents", v."autopay"`;
  return prisma.$queryRaw<FactsRow[]>(Prisma.sql`
    SELECT v."id", u."name" AS "userName", u."email" AS "userEmail",
      c."companyName", c."isPropertyManager", c."phone", c."createdAt",
      v."activeCount", v."pendingCount", v."endedCount",
      ${money},
      v."oldestOpenDueDate",
      v."nextBillOn", v."endingOn", v."pickupAt"
    ${factsFromSql(ids)}
    WHERE v."id" IN (${Prisma.join(ids)})`);
}

/** The display-only facts, hydrated for the rows a window actually shows. */
type Hydration = {
  nextVisitAt: Date | null;
  nextVisitType: string | null;
  nextVisitDurationMinutes: number | null;
  pastDueCents: number | null;
  obId: string | null;
  obStatus: string | null;
  obOwed: number | null;
  obStripe: string | null;
  obSale: string | null;
  propertyCount: number;
  city: string | null;
};

const EMPTY_HYDRATION: Hydration = {
  nextVisitAt: null,
  nextVisitType: null,
  nextVisitDurationMinutes: null,
  pastDueCents: null,
  obId: null,
  obStatus: null,
  obOwed: null,
  obStripe: null,
  obSale: null,
  propertyCount: 0,
  city: null,
};

const NULL_PD_LATERAL = Prisma.sql`LEFT JOIN LATERAL (SELECT NULL::int AS "pastDueCents") pd ON true`;
const NULL_OB_LATERAL = Prisma.sql`LEFT JOIN LATERAL (SELECT NULL::text AS "obId", NULL::text AS "obStatus", NULL::int AS "obOwed", NULL::text AS "obStripe", NULL::text AS "obSale") ob ON true`;

/**
 * The per-row detail laterals (next visit + its duration, property count
 * and city, past-due sum, oldest open bill) for just the rows a list window
 * actually shows — at most WINDOW_CAP ids per call. These are the view's
 * own lateral definitions, keyed on the base Customer row. Staff never
 * receives the money laterals. Callers chunk long id lists themselves.
 */
async function hydrateWindow(
  ids: string[],
  staff: boolean,
  startToday: Date,
): Promise<Map<string, Hydration>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<(Hydration & { id: string })[]>(Prisma.sql`
    SELECT c."id",
      nv."nextVisitAt", nv."nextVisitType",
      nj."nextVisitDurationMinutes",
      pd."pastDueCents",
      ob."obId", ob."obStatus", ob."obOwed", ob."obStripe", ob."obSale",
      s."propertyCount", s."city"
    FROM "Customer" c
    LEFT JOIN LATERAL (
      SELECT j."scheduledAt" AS "nextVisitAt", j."type" AS "nextVisitType"
      FROM "Job" j
      WHERE j."customerId" = c."id"
        AND j."status" IN ('SCHEDULED', 'IN_PROGRESS')
        AND j."scheduledAt" >= now()
      ORDER BY j."scheduledAt" ASC, j."id" ASC
      LIMIT 1
    ) nv ON true
    LEFT JOIN LATERAL (
      SELECT j."durationMinutes" AS "nextVisitDurationMinutes"
      FROM "Job" j
      WHERE j."customerId" = c."id" AND j."status" IN ('SCHEDULED', 'IN_PROGRESS')
        AND j."scheduledAt" = nv."nextVisitAt" AND j."type" = nv."nextVisitType"
      ORDER BY j."id" ASC LIMIT 1
    ) nj ON true
    ${staff ? NULL_PD_LATERAL : Prisma.sql`LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(GREATEST(0, inv."amountDueCents" - inv."amountPaidCents")), 0)::int AS "pastDueCents"
      FROM "Invoice" inv
      WHERE inv."customerId" = c."id"
        AND inv."status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED')
        AND inv."amountDueCents" > inv."amountPaidCents"
        AND inv."dueDate" < ${startToday}
    ) pd ON true`}
    ${staff ? NULL_OB_LATERAL : Prisma.sql`LEFT JOIN LATERAL (
      SELECT i."id" AS "obId", i."status"::text AS "obStatus",
        GREATEST(i."amountDueCents" - i."amountPaidCents", 0)::int AS "obOwed",
        i."stripeInvoiceId" AS "obStripe", i."saleKind" AS "obSale"
      FROM "Invoice" i
      WHERE i."customerId" = c."id"
        AND i."status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED')
        AND i."amountDueCents" > i."amountPaidCents"
      ORDER BY i."dueDate" ASC NULLS LAST, i."createdAt" ASC
      LIMIT 1
    ) ob ON true`}
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS "propertyCount",
        (SELECT sa."city" FROM "ServiceAddress" sa
          WHERE sa."customerId" = c."id"
          ORDER BY sa."createdAt" ASC, sa."id" ASC LIMIT 1) AS "city"
      FROM "ServiceAddress" sa2
      WHERE sa2."customerId" = c."id"
    ) s ON true
    WHERE c."id" IN (${Prisma.join(ids)})`);
  return new Map(rows.map((r) => [r.id, r]));
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
  const scoped = (p.q?.trim().length ?? 0) >= 2;
  const orderedIds = await fetchOrderedIds(where, sort, startToday, windowEnd, scoped);

  const cursor = decodeCursor(p.cursor);
  const through = cursor ? orderedIds.indexOf(cursor.id) + 1 : 0;
  const windowIds = orderedIds.slice(
    0,
    Math.min(through + (p.pageSize ?? PAGE_SIZE), WINDOW_CAP),
  );
  const facts = await fetchFactsByIds(windowIds, staff);
  const factsById = new Map(facts.map((f) => [f.id, f]));
  const hydration = await hydrateWindow(windowIds, staff, startToday);
  const capped = windowIds.length >= WINDOW_CAP && orderedIds.length > windowIds.length;
  const hasMore = !capped && orderedIds.length > windowIds.length;
  const lastFacts = windowIds.length
    ? factsById.get(windowIds[windowIds.length - 1])
    : undefined;
  const nextCursor =
    hasMore && lastFacts
      ? encodeCursor({
          v: sortValueOf(sort, lastFacts, startToday, windowEnd),
          id: lastFacts.id,
        })
      : null;

  const rows: CustomerListRow[] = windowIds.map((id) => {
    const r: RawRow = {
      ...factsById.get(id)!,
      ...(hydration.get(id) ?? EMPTY_HYDRATION),
    };
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
      ? Prisma.sql`c."id" IN (${Prisma.join(p.ids.slice(0, 500))})`
      : Prisma.sql`${filtersSql(p, false)} AND ${segmentSql(p, startToday, windowEnd)}`;
  const orderedIds = (
    await fetchOrderedIds(
      where,
      sort,
      startToday,
      windowEnd,
      (p.ids?.length ?? 0) > 0 || (p.q?.trim().length ?? 0) >= 2,
    )
  ).slice(0, 10_000);
  const factsById = new Map<string, FactsRow>();
  const hydration = new Map<string, Hydration>();
  for (let i = 0; i < orderedIds.length; i += WINDOW_CAP) {
    const chunkIds = orderedIds.slice(i, i + WINDOW_CAP);
    for (const f of await fetchFactsByIds(chunkIds, false))
      factsById.set(f.id, f);
    const chunk = await hydrateWindow(chunkIds, false, startToday);
    for (const [id, h] of chunk) hydration.set(id, h);
  }
  const all: RawRow[] = orderedIds.map((id) => ({
    ...factsById.get(id)!,
    ...(hydration.get(id) ?? EMPTY_HYDRATION),
  }));
  return all.map((r) => ({
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
    ${FACTS_FROM}
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
