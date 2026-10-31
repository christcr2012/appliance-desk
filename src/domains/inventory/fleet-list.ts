import { Prisma, type AcquisitionTaxStatus, type ApplianceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ALL_APPLIANCE_STATUSES } from "./lifecycle";

/** The fleet tabs and the statuses each contains (spec section 3). The
 * "all" tab is everything except RETIRED — retired units live on the
 * Retired page. */
export type FleetTab = "all" | "ready" | "out" | "coming-back" | "needs-work";
export type FleetSort = "newest" | "number" | "type";

export const FLEET_TAB_STATUSES: Record<FleetTab, ApplianceStatus[]> = {
  all: ALL_APPLIANCE_STATUSES.filter((s) => s !== "RETIRED"),
  ready: ["AVAILABLE"],
  out: ["RENTED", "RESERVED"],
  "coming-back": ["AWAITING_PICKUP"],
  "needs-work": ["AWAITING_INSPECTION", "CLEANING", "MAINTENANCE"],
};

export type FleetParams = {
  tab: FleetTab;
  type?: string;
  tax?: AcquisitionTaxStatus;
  q: string;
  sort: FleetSort;
  cursor?: string;
};

/**
 * AR-6 section 3: the Fleet list reads.
 *
 * Cursor-paged in every sort (fix 7: offset paging over createdAt alone
 * repeats or skips units created in the same instant — a purchase creates
 * several at once). The ordered page of ids is selected in SQL
 * (parameterized throughout) because the "type" sort orders by the type's
 * name and the search ORs three match rules; rows are then loaded typed
 * through Prisma and re-ordered in memory. Custody names for the page's
 * rented/awaiting-pickup rows come from ONE batched query, never per row.
 */

export type FleetRow = {
  id: string;
  assetNumber: string;
  status: ApplianceStatus;
  manufacturer: string | null;
  model: string | null;
  color: string | null;
  currentLocation: string | null;
  typeName: string;
  typeSlug: string;
  awayForRepair: boolean;
  custody: { customerName: string; city: string | null } | null;
};

export type FleetCounts = Record<FleetTab, number>;

type CursorKey = { sort: string; parts: string[]; id: string };

function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

function decodeCursor(raw: string | undefined, sort: string): CursorKey | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as CursorKey;
    if (parsed.sort !== sort || typeof parsed.id !== "string" || !Array.isArray(parsed.parts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function filterSql(params: FleetParams, statuses: ApplianceStatus[]): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`a."status" IN (${Prisma.join(statuses.map((s) => Prisma.sql`${s}`))})`,
  ];
  if (params.type) {
    conditions.push(Prisma.sql`t."slug" = ${params.type}`);
  }
  if (params.tax) {
    conditions.push(Prisma.sql`a."acquisitionTaxStatus" = ${params.tax}`);
  }
  if (params.q) {
    const like = `%${params.q.replace(/[%_\\]/g, "\\$&")}%`;
    const prefix = `${params.q.replace(/[%_\\]/g, "\\$&")}%`;
    conditions.push(
      Prisma.sql`(a."assetNumber" ILIKE ${prefix} OR a."serialNumber" ILIKE ${params.q} OR a."model" ILIKE ${like})`,
    );
  }
  return Prisma.join(conditions, " AND ");
}

function cursorSql(cursor: CursorKey, sort: FleetParams["sort"]): Prisma.Sql {
  if (sort === "newest") {
    const created = new Date(cursor.parts[0]);
    return Prisma.sql`(a."createdAt" < ${created} OR (a."createdAt" = ${created} AND a."id" < ${cursor.id}))`;
  }
  if (sort === "number") {
    return Prisma.sql`(a."assetNumber" > ${cursor.parts[0]} OR (a."assetNumber" = ${cursor.parts[0]} AND a."id" > ${cursor.id}))`;
  }
  // type: (type name, asset number, id) all ascending.
  return Prisma.sql`(t."name" > ${cursor.parts[0]}
    OR (t."name" = ${cursor.parts[0]} AND a."assetNumber" > ${cursor.parts[1]})
    OR (t."name" = ${cursor.parts[0]} AND a."assetNumber" = ${cursor.parts[1]} AND a."id" > ${cursor.id}))`;
}

function orderSql(sort: FleetParams["sort"]): Prisma.Sql {
  if (sort === "newest") return Prisma.sql`a."createdAt" DESC, a."id" DESC`;
  if (sort === "number") return Prisma.sql`a."assetNumber" ASC, a."id" ASC`;
  return Prisma.sql`t."name" ASC, a."assetNumber" ASC, a."id" ASC`;
}

export async function getFleet(
  params: FleetParams,
  take = 50,
): Promise<{ rows: FleetRow[]; nextCursor: string | null }> {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const limit = Math.min(Math.max(take, 1), 200);
  const statuses = FLEET_TAB_STATUSES[params.tab];
  const cursor = decodeCursor(params.cursor, params.sort);

  const where = cursor
    ? Prisma.sql`${filterSql(params, statuses)} AND ${cursorSql(cursor, params.sort)}`
    : filterSql(params, statuses);

  const page = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT a."id" FROM "Appliance" a
    JOIN "ApplianceType" t ON t."id" = a."applianceTypeId"
    WHERE ${where}
    ORDER BY ${orderSql(params.sort)}
    LIMIT ${limit + 1}
  `;
  const hasMore = page.length > limit;
  const pageIds = page.slice(0, limit).map((r) => r.id);
  if (pageIds.length === 0) return { rows: [], nextCursor: null };

  const [appliances, openPeriods, openCustody] = await Promise.all([
    prisma.appliance.findMany({
      where: { id: { in: pageIds } },
      select: {
        id: true, assetNumber: true, status: true, manufacturer: true, model: true,
        color: true, currentLocation: true, createdAt: true,
        applianceType: { select: { name: true, slug: true } },
      },
    }),
    prisma.outOfServicePeriod.findMany({
      where: { applianceId: { in: pageIds }, endedOn: null },
      select: { applianceId: true },
    }),
    prisma.applianceCustodyEpisode.findMany({
      where: { applianceId: { in: pageIds }, closedAt: null },
      select: {
        applianceId: true,
        customer: {
          select: {
            companyName: true,
            user: { select: { name: true, email: true } },
          },
        },
        serviceAddress: { select: { city: true } },
      },
    }),
  ]);
  const byId = new Map(appliances.map((a) => [a.id, a]));
  const away = new Set(openPeriods.map((p) => p.applianceId));
  const custodyBy = new Map(
    openCustody.map((c) => [
      c.applianceId,
      {
        customerName: c.customer.companyName ?? c.customer.user.name ?? c.customer.user.email,
        city: c.serviceAddress?.city ?? null,
      },
    ]),
  );

  const rows: FleetRow[] = pageIds.map((id) => {
    const a = byId.get(id)!;
    return {
      id: a.id,
      assetNumber: a.assetNumber,
      status: a.status,
      manufacturer: a.manufacturer,
      model: a.model,
      color: a.color,
      currentLocation: a.currentLocation,
      typeName: a.applianceType.name,
      typeSlug: a.applianceType.slug,
      awayForRepair: away.has(a.id),
      custody:
        a.status === "RENTED" || a.status === "AWAITING_PICKUP"
          ? (custodyBy.get(a.id) ?? null)
          : null,
    };
  });

  let nextCursor: string | null = null;
  if (hasMore) {
    const lastId = pageIds[pageIds.length - 1];
    const last = byId.get(lastId)!;
    const parts =
      params.sort === "newest"
        ? [last.createdAt.toISOString()]
        : params.sort === "number"
          ? [last.assetNumber]
          : [last.applianceType.name, last.assetNumber];
    nextCursor = encodeCursor({ sort: params.sort, parts, id: lastId });
  }
  return { rows, nextCursor };
}

/** Active appliance types for the Type filter, in display order. */
export async function getFleetTypeOptions(): Promise<{ slug: string; name: string }[]> {
  await requireRole("OWNER", "ADMIN", "STAFF");
  return prisma.applianceType.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { slug: true, name: true },
  });
}

/** Tab counts under the current type/tax/search filters — one groupBy. */
export async function getFleetCounts(params: FleetParams): Promise<FleetCounts> {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const where: Prisma.ApplianceWhereInput = {
    status: { in: FLEET_TAB_STATUSES.all },
    ...(params.type ? { applianceType: { slug: params.type } } : {}),
    ...(params.tax ? { acquisitionTaxStatus: params.tax } : {}),
    ...(params.q
      ? {
          OR: [
            { assetNumber: { startsWith: params.q, mode: "insensitive" as const } },
            { serialNumber: { equals: params.q, mode: "insensitive" as const } },
            { model: { contains: params.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const grouped = await prisma.appliance.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });
  const byStatus = new Map(grouped.map((g) => [g.status, g._count._all]));
  const sum = (statuses: ApplianceStatus[]) =>
    statuses.reduce((total, s) => total + (byStatus.get(s) ?? 0), 0);
  return {
    all: sum(FLEET_TAB_STATUSES.all),
    ready: sum(FLEET_TAB_STATUSES.ready),
    out: sum(FLEET_TAB_STATUSES.out),
    "coming-back": sum(FLEET_TAB_STATUSES["coming-back"]),
    "needs-work": sum(FLEET_TAB_STATUSES["needs-work"]),
  };
}
