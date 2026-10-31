/**
 * CU-1 (AR-4c, CUSTOMERS spec section 3): customer segments — one rule set in
 * three shapes that must never drift: the pure function (row pills, tests),
 * the SQL fragment over the facts columns (segment counts), and the EXISTS
 * fragment over the base tables (the tab filter, CU1-PERF). The integration
 * test proves the tab query returns exactly the customers whose
 * customerSegments() includes the segment, on 30 fixtures, and that the
 * counts match the tab sizes.
 *
 * Rules (design CUSTOMERS-WORKSPACE section 4):
 * - setting-up: has pending agreements and none active yet
 * - active:     at least one ACTIVE agreement
 * - owes:       something past due (oldest open due date before today, Denver)
 * - ending:     an ending date or a pickup inside the ending-notice window
 * - past:       nothing active or pending, but something ended before
 * - new:        none of the above
 * A customer can be in several segments at once (active + owes + ending).
 */
import { Prisma } from "@prisma/client";
import { businessDayBounds } from "@/lib/business-date";

export const CUSTOMER_SEGMENTS = [
  "setting-up",
  "active",
  "owes",
  "ending",
  "past",
  "new",
] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

/** The view facts the segment rules read (customer_list_v1 columns).
 * Since CU1-PERF these are computed from the base tables in list.ts, and
 * CU1-VIEW retired the view itself; the wording records the shape's origin. */
export type CustomerSegmentFacts = {
  activeCount: number;
  pendingCount: number;
  endedCount: number;
  oldestOpenDueDate: Date | null;
  endingOn: Date | null;
  pickupAt: Date | null;
};

/** Start of today in Denver — the "past due" line, shared by both shapes. */
export function startOfTodayDenver(now: Date): Date {
  return businessDayBounds(now).start;
}

/** The last moment still inside the ending window. */
export function endingWindowEnd(now: Date, endingDays: number): Date {
  return new Date(startOfTodayDenver(now).getTime() + endingDays * 86_400_000);
}

export function customerSegments(
  row: CustomerSegmentFacts,
  now: Date,
  endingDays: number,
): CustomerSegment[] {
  const out: CustomerSegment[] = [];
  const startToday = startOfTodayDenver(now);
  const windowEnd = endingWindowEnd(now, endingDays);
  const owes =
    row.oldestOpenDueDate !== null && row.oldestOpenDueDate < startToday;
  const ending =
    (row.endingOn !== null && row.endingOn < windowEnd) ||
    (row.pickupAt !== null && row.pickupAt < windowEnd);
  if (row.pendingCount > 0 && row.activeCount === 0) out.push("setting-up");
  if (row.activeCount > 0) out.push("active");
  if (owes) out.push("owes");
  if (ending) out.push("ending");
  if (row.activeCount === 0 && row.pendingCount === 0 && row.endedCount > 0)
    out.push("past");
  if (out.length === 0) out.push("new");
  return out;
}

/**
 * The same conditions as EXISTS probes over the base tables, relative to a
 * Customer row aliased "c" (CU1-PERF: the list's ordering phase and the
 * searches use this shape — indexed probes instead of computing every
 * customer's aggregates first). Each form is the aggregate rule restated:
 * a MIN(...) < bound is "an exists below the bound", a count > 0 is an
 * exists, a count = 0 is a not-exists. The integration test pins this shape
 * against the pure rule (tab sizes) and against the facts shape (counts).
 */
export function segmentExistsSql(
  segment: CustomerSegment,
  startToday: Date,
  windowEnd: Date,
): Prisma.Sql {
  const active = Prisma.sql`EXISTS (SELECT 1 FROM "RentalAgreement" ra
    WHERE ra."customerId" = c."id" AND ra."status" = 'ACTIVE')`;
  const pending = Prisma.sql`EXISTS (SELECT 1 FROM "RentalAgreement" ra
    WHERE ra."customerId" = c."id"
      AND (ra."status" IN ('DRAFT', 'AWAITING_SIGNATURE', 'SCHEDULED')
        OR (ra."status" = 'ACTIVE' AND ra."firstDeliveredOn" IS NULL)))`;
  const ended = Prisma.sql`EXISTS (SELECT 1 FROM "RentalAgreement" ra
    WHERE ra."customerId" = c."id" AND ra."status" = 'ENDED')`;
  const owes = Prisma.sql`EXISTS (SELECT 1 FROM "Invoice" inv
    WHERE inv."customerId" = c."id"
      AND inv."status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED')
      AND inv."amountDueCents" > inv."amountPaidCents"
      AND inv."dueDate" < ${startToday})`;
  const ending = Prisma.sql`(EXISTS (SELECT 1 FROM "RentalAgreement" ra
      WHERE ra."customerId" = c."id" AND ra."status" = 'ACTIVE'
        AND ra."termMonths" IS NOT NULL AND ra."terminationRequestedAt" IS NULL
        AND ra."endDate" < ${windowEnd})
    OR EXISTS (SELECT 1 FROM "Job" j
      WHERE j."customerId" = c."id" AND j."type" = 'REMOVAL'
        AND j."status" = 'SCHEDULED' AND j."scheduledAt" < ${windowEnd}))`;
  switch (segment) {
    case "setting-up":
      return Prisma.sql`${pending} AND NOT (${active})`;
    case "active":
      return active;
    case "owes":
      return owes;
    case "ending":
      return ending;
    case "past":
      return Prisma.sql`NOT (${active}) AND NOT (${pending}) AND ${ended}`;
    case "new":
      return Prisma.sql`NOT (${active}) AND NOT (${pending}) AND NOT (${ended}) AND NOT (${owes}) AND NOT (${ending})`;
  }
}

/**
 * The same conditions as SQL over the facts relation. `alias` is the facts
 * alias in the reading query ("v" — the grouped base-table facts in
 * list.ts); the two date parameters are the Denver start-of-today and the
 * ending-window end for the same `now`.
 */
export function segmentWhereSql(
  segment: CustomerSegment,
  alias: string,
  startToday: Date,
  windowEnd: Date,
): Prisma.Sql {
  const a = Prisma.raw(`"${alias}"`);
  // Null-safe: a NULL date is "not owes" / "not ending" (the pure rule's
  // meaning), never an unknown — otherwise NOT(...) in the "new" fragment
  // would swallow every dateless customer.
  const owes = Prisma.sql`(${a}."oldestOpenDueDate" IS NOT NULL AND ${a}."oldestOpenDueDate" < ${startToday})`;
  const ending = Prisma.sql`(COALESCE(${a}."endingOn" < ${windowEnd}, false) OR COALESCE(${a}."pickupAt" < ${windowEnd}, false))`;
  switch (segment) {
    case "setting-up":
      return Prisma.sql`${a}."pendingCount" > 0 AND ${a}."activeCount" = 0`;
    case "active":
      return Prisma.sql`${a}."activeCount" > 0`;
    case "owes":
      return owes;
    case "ending":
      return ending;
    case "past":
      return Prisma.sql`${a}."activeCount" = 0 AND ${a}."pendingCount" = 0 AND ${a}."endedCount" > 0`;
    case "new":
      return Prisma.sql`${a}."activeCount" = 0 AND ${a}."pendingCount" = 0 AND ${a}."endedCount" = 0 AND NOT (${owes}) AND NOT (${ending})`;
  }
}
