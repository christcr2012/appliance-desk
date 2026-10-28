// AR-4a (RENTALS spec section 2): role-aware reads for the Rentals list.
// STAFF rows never query or carry money (the staff row type has no price
// fields at all), exactly like getDeskAgreementsPage's staff branch. Paging
// follows the KIT 5.1 cursor rule: the window grows from the start through
// the cursor row plus the next page, capped at 500 rows.
import type { Prisma, RentalAgreementStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import {
  businessDateFromKey,
  businessDateKey,
  businessMonthBounds,
} from "@/lib/business-date";
import { getRentalEndingNoticeDays } from "./ending-notice";

export const RENTAL_TABS = [
  "active",
  "signing",
  "starting",
  "drafts",
  "ended",
  "cancelled",
] as const;
export type RentalTab = (typeof RENTAL_TABS)[number];

export const RENTAL_TAB_STATUS: Record<RentalTab, RentalAgreementStatus> = {
  active: "ACTIVE",
  signing: "AWAITING_SIGNATURE",
  starting: "SCHEDULED",
  drafts: "DRAFT",
  ended: "ENDED",
  cancelled: "CANCELLED",
};

export const RENTAL_SORTS = [
  "newest",
  "ends-soonest",
  "rent-desc",
  "customer-asc",
] as const;
export type RentalSort = (typeof RENTAL_SORTS)[number];

export type RentalsParams = {
  status: RentalTab;
  starts?: "this-week" | "this-month";
  ends?: "this-week" | "this-month" | "ending-soon";
  q?: string;
  sort: RentalSort;
  cursor?: string;
  /** Rows per window growth step (default 50, KIT 5.1); tests shrink it. */
  pageSize?: number;
};

export type RentalListLine = {
  label: string;
  packageId: string | null;
  assignments: {
    appliance: { assetNumber: string; applianceType: { name: string } };
  }[];
};

export type RentalListRowBase = {
  id: string;
  status: RentalAgreementStatus;
  startDate: Date | null;
  endDate: Date | null;
  termMonths: number | null;
  reservationExpiresAt: Date | null;
  createdAt: Date;
  customerId: string;
  customerName: string;
  companyName: string | null;
  addressLine1: string | null;
  city: string | null;
};

export type OwnerRentalRow = RentalListRowBase & {
  monthlyCents: number;
  lines: (RentalListLine & { monthlyPriceCents: number })[];
};
export type StaffRentalRow = RentalListRowBase & {
  monthlyCents?: never;
  lines?: never;
  /** Staff see the count only, never line labels: a label is owner-written
   * text that can carry a price ("…$60/mo"), exactly why the old list's
   * staff branch selected only the count. */
  applianceCount: number;
};

export type RentalsResult =
  | { staff: false; rows: OwnerRentalRow[]; nextCursor: string | null; capped: boolean }
  | { staff: true; rows: StaffRentalRow[]; nextCursor: string | null; capped: boolean };

export const RENTALS_PAGE_SIZE = 50;
export const RENTALS_WINDOW_CAP = 500;
const DAY_MS = 86_400_000;

/** Denver week (Monday 00:00 through the next Monday), DST-safe via date keys. */
export function denverWeekBounds(now: Date): { start: Date; end: Date } {
  const key = businessDateKey(now);
  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const back = (dow + 6) % 7;
  const fmt = (t: Date) =>
    `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
      t.getUTCDate(),
    ).padStart(2, "0")}`;
  const monday = new Date(Date.UTC(y, m - 1, d - back));
  const next = new Date(Date.UTC(y, m - 1, d - back + 7));
  return {
    start: businessDateFromKey(fmt(monday)) as Date,
    end: businessDateFromKey(fmt(next)) as Date,
  };
}

function presetBounds(preset: "this-week" | "this-month", now: Date) {
  return preset === "this-week" ? denverWeekBounds(now) : businessMonthBounds(now);
}

/** The To do RENTAL_ENDING_SOON rule (turning-points-attention): ACTIVE, fixed
 * term, no termination requested, endDate within the notice window, and not
 * already renewed. Returns the matching agreement ids. */
async function endingSoonIds(now: Date): Promise<string[]> {
  const days = await getRentalEndingNoticeDays();
  const candidates = await prisma.rentalAgreement.findMany({
    where: {
      status: "ACTIVE",
      termMonths: { not: null },
      terminationRequestedAt: null,
      endDate: { gte: now, lte: new Date(now.getTime() + days * DAY_MS) },
    },
    select: { id: true },
  });
  const renewed = new Set(
    (
      await prisma.rentalAgreement.findMany({
        where: {
          renewedFromAgreementId: { in: candidates.map((c) => c.id) },
          status: { not: "CANCELLED" },
        },
        select: { renewedFromAgreementId: true },
      })
    ).map((r) => r.renewedFromAgreementId),
  );
  return candidates.map((c) => c.id).filter((id) => !renewed.has(id));
}

async function rentalsWhere(
  params: RentalsParams,
  now: Date,
  opts: { ignoreStatus?: boolean; ignoreEndingSoon?: boolean } = {},
): Promise<Prisma.RentalAgreementWhereInput> {
  const and: Prisma.RentalAgreementWhereInput[] = [];
  // The ending-soon rule defines its own status (ACTIVE), so it replaces the
  // tab filter instead of intersecting with it.
  const endingSoonApplies = params.ends === "ending-soon" && !opts.ignoreEndingSoon;
  if (!opts.ignoreStatus && !endingSoonApplies) {
    and.push({ status: RENTAL_TAB_STATUS[params.status] });
  }
  if (params.starts) {
    const b = presetBounds(params.starts, now);
    and.push({ startDate: { gte: b.start, lt: b.end } });
  }
  if (params.ends === "this-week" || params.ends === "this-month") {
    const b = presetBounds(params.ends, now);
    and.push({ endDate: { gte: b.start, lt: b.end } });
  }
  if (endingSoonApplies) {
    const ids = await endingSoonIds(now);
    and.push({ id: { in: ids } });
  }
  if (params.q) {
    const q = params.q;
    and.push({
      OR: [
        { customer: { user: { name: { contains: q, mode: "insensitive" } } } },
        { customer: { user: { email: { contains: q, mode: "insensitive" } } } },
        { customer: { companyName: { contains: q, mode: "insensitive" } } },
        { serviceAddress: { line1: { contains: q, mode: "insensitive" } } },
        { serviceAddress: { city: { contains: q, mode: "insensitive" } } },
        {
          lines: {
            some: {
              assignments: {
                some: { unassignedAt: null, appliance: { assetNumber: q } },
              },
            },
          },
        },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

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

/** Every matching agreement id in the chosen order, with its sort value. */
async function orderedIds(
  where: Prisma.RentalAgreementWhereInput,
  sort: RentalSort,
): Promise<CursorValue[]> {
  if (sort === "rent-desc") {
    const [agreements, sums] = await Promise.all([
      prisma.rentalAgreement.findMany({ where, select: { id: true } }),
      prisma.rentalLine.groupBy({
        by: ["agreementId"],
        _sum: { monthlyPriceCents: true },
        where: { agreement: where },
      }),
    ]);
    const byId = new Map(sums.map((s) => [s.agreementId, s._sum.monthlyPriceCents ?? 0]));
    return agreements
      .map((a) => ({ v: byId.get(a.id) ?? 0, id: a.id }))
      .sort((a, b) => Number(b.v) - Number(a.v) || a.id.localeCompare(b.id));
  }
  if (sort === "ends-soonest") {
    const rows = await prisma.rentalAgreement.findMany({
      where,
      select: { id: true, endDate: true },
      orderBy: [{ endDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    });
    return rows.map((r) => ({ v: r.endDate ? r.endDate.toISOString() : null, id: r.id }));
  }
  if (sort === "customer-asc") {
    const rows = await prisma.rentalAgreement.findMany({
      where,
      select: { id: true, customer: { select: { user: { select: { name: true } } } } },
      orderBy: [{ customer: { user: { name: "asc" } } }, { id: "asc" }],
    });
    return rows.map((r) => ({ v: r.customer.user.name, id: r.id }));
  }
  const rows = await prisma.rentalAgreement.findMany({
    where,
    select: { id: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map((r) => ({ v: r.createdAt.toISOString(), id: r.id }));
}

const LINE_SELECT = {
  label: true,
  packageId: true,
  assignments: {
    where: { unassignedAt: null },
    select: {
      appliance: {
        select: { assetNumber: true, applianceType: { select: { name: true } } },
      },
    },
  },
} as const;

export async function getRentals(
  params: RentalsParams,
  now: Date = new Date(),
): Promise<RentalsResult> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const staff = session.user.role === "STAFF";
  const where = await rentalsWhere(params, now);
  const ordered = await orderedIds(where, params.sort);
  const cursor = decodeCursor(params.cursor);
  const through = cursor ? ordered.findIndex((o) => o.id === cursor.id) + 1 : 0;
  const windowValues = ordered.slice(
    0,
    Math.min(through + (params.pageSize ?? RENTALS_PAGE_SIZE), RENTALS_WINDOW_CAP),
  );
  const capped = windowValues.length >= RENTALS_WINDOW_CAP && ordered.length > windowValues.length;
  const hasMore = !capped && ordered.length > windowValues.length;
  const nextCursor = hasMore
    ? encodeCursor(windowValues[windowValues.length - 1])
    : null;
  const ids = windowValues.map((o) => o.id);
  if (ids.length === 0) {
    return staff
      ? { staff: true, rows: [], nextCursor, capped }
      : { staff: false, rows: [], nextCursor, capped };
  }
  const baseSelect = {
    id: true,
    status: true,
    startDate: true,
    endDate: true,
    termMonths: true,
    reservationExpiresAt: true,
    createdAt: true,
    customerId: true,
    customer: {
      select: {
        companyName: true,
        user: { select: { name: true, email: true } },
      },
    },
    serviceAddress: { select: { line1: true, city: true } },
  } as const;
  const byId = new Map<string, OwnerRentalRow | StaffRentalRow>();
  if (staff) {
    const rows = await prisma.rentalAgreement.findMany({
      where: { id: { in: ids } },
      select: { ...baseSelect, _count: { select: { lines: true } } },
    });
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id, status: r.status, startDate: r.startDate, endDate: r.endDate,
        termMonths: r.termMonths, reservationExpiresAt: r.reservationExpiresAt,
        createdAt: r.createdAt, customerId: r.customerId,
        customerName: r.customer.user.name ?? r.customer.user.email, companyName: r.customer.companyName,
        addressLine1: r.serviceAddress?.line1 ?? null,
        city: r.serviceAddress?.city ?? null,
        applianceCount: r._count.lines,
      });
    }
    return {
      staff: true,
      rows: ids.map((id) => byId.get(id) as StaffRentalRow),
      nextCursor,
      capped,
    };
  }
  const rows = await prisma.rentalAgreement.findMany({
    where: { id: { in: ids } },
    select: {
      ...baseSelect,
      lines: { select: { ...LINE_SELECT, monthlyPriceCents: true } },
    },
  });
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id, status: r.status, startDate: r.startDate, endDate: r.endDate,
      termMonths: r.termMonths, reservationExpiresAt: r.reservationExpiresAt,
      createdAt: r.createdAt, customerId: r.customerId,
      customerName: r.customer.user.name ?? r.customer.user.email, companyName: r.customer.companyName,
      addressLine1: r.serviceAddress?.line1 ?? null,
      city: r.serviceAddress?.city ?? null,
      lines: r.lines,
      monthlyCents: r.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0),
    });
  }
  return {
    staff: false,
    rows: ids.map((id) => byId.get(id) as OwnerRentalRow),
    nextCursor,
    capped,
  };
}

/** Tab counts from one groupBy: same filters as the list except the status
 * tab itself (KIT 5.1). The ending-soon preset is a status rule, so counts
 * ignore it too — a count per tab under it would only ever light up Active. */
export async function getRentalCounts(
  params: RentalsParams,
  now: Date = new Date(),
): Promise<Record<RentalTab, number>> {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const where = await rentalsWhere(params, now, {
    ignoreStatus: true,
    ignoreEndingSoon: true,
  });
  const grouped = await prisma.rentalAgreement.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });
  const counts = Object.fromEntries(
    RENTAL_TABS.map((tab) => [tab, 0]),
  ) as Record<RentalTab, number>;
  for (const g of grouped) {
    const tab = (Object.keys(RENTAL_TAB_STATUS) as RentalTab[]).find(
      (t) => RENTAL_TAB_STATUS[t] === g.status,
    );
    if (tab) counts[tab] = g._count._all;
  }
  return counts;
}
