/**
 * CU-1 (AR-4c, CUSTOMERS spec section 3): customer segments — one rule set in
 * two shapes that must never drift: the pure function (row pills, tests) and
 * the SQL fragment the tab filter uses. The integration test proves the tab
 * query returns exactly the customers whose customerSegments() includes the
 * segment, on 30 fixtures.
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

/** The view facts the segment rules read (customer_list_v1 columns). */
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
 * The same conditions as SQL over a customer_list_v1 alias. `alias` is the
 * view's alias in the reading query ("v"); the two date parameters are the
 * Denver start-of-today and the ending-window end for the same `now`.
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
