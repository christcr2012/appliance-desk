import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/session";

/**
 * AR-6 fix 2 + spec section 6: the Parts list read.
 *
 * One cursor-paged read for the Parts page and the retired panel's part
 * picker. The DTO is shaped by the actor's role at the query boundary:
 * staff rows never carry the money keys at all (retailPriceCents,
 * resaleCostOnHandCents, resaleUnitsOnHand are absent, not nulled), so no
 * page can leak them by rendering the wrong field.
 *
 * The low-stock flag uses the getLowStockParts rule — a threshold is set
 * AND quantityOnHand is at or below it. Column-to-column comparison cannot
 * be expressed in a Prisma where, so the ordered page of ids is selected
 * in SQL (parameterized throughout) and the rows are then loaded typed;
 * that is also what lets the "low" tab page instead of filtering in
 * memory after the fact.
 */

export type PartsListStatus = "in-stock" | "low" | "archived";

export type PartsListParams = {
  status?: PartsListStatus;
  q?: string;
  /** Appliance type id. */
  type?: string;
  cursor?: { modelNumber: string; id: string };
  take?: number;
};

export type PartsActor = { role: Role };

export type PartListRow = {
  id: string;
  modelNumber: string;
  manufacturer: string | null;
  partNumber: string;
  partName: string | null;
  notes: string | null;
  applianceTypeId: string | null;
  applianceTypeName: string | null;
  quantityOnHand: number;
  reorderThreshold: number | null;
  lowStock: boolean;
  archived: boolean;
  sellable: boolean;
  // OWNER/ADMIN only — the keys are absent entirely for STAFF.
  retailPriceCents?: number | null;
  resaleCostOnHandCents?: number;
  resaleUnitsOnHand?: number;
  /** Average cost of one resale unit on hand; null when none are on hand. */
  averageResaleCostCents?: number | null;
  /** Whether the part is usually bought to resell (order-form pre-tick). */
  defaultForResale?: boolean;
};

const TEAM: Role[] = ["OWNER", "ADMIN", "STAFF"];

export async function getPartsList(
  params: PartsListParams,
  actor: PartsActor,
): Promise<{ rows: PartListRow[]; nextCursor: { modelNumber: string; id: string } | null }> {
  if (!TEAM.includes(actor.role)) {
    throw new Error("Only the team can see parts.");
  }
  const status = params.status ?? "in-stock";
  const take = Math.min(Math.max(params.take ?? 50, 1), 200);

  const conditions: Prisma.Sql[] = [];
  if (status === "archived") {
    conditions.push(Prisma.sql`"archivedAt" IS NOT NULL`);
  } else {
    conditions.push(Prisma.sql`"archivedAt" IS NULL`);
  }
  if (status === "low") {
    conditions.push(
      Prisma.sql`"reorderThreshold" IS NOT NULL AND "quantityOnHand" <= "reorderThreshold"`,
    );
  }
  if (params.type) {
    conditions.push(Prisma.sql`"applianceTypeId" = ${params.type}`);
  }
  const q = params.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    conditions.push(
      Prisma.sql`("modelNumber" ILIKE ${like} OR "partNumber" ILIKE ${like} OR "partName" ILIKE ${like})`,
    );
  }
  if (params.cursor) {
    conditions.push(
      Prisma.sql`("modelNumber" > ${params.cursor.modelNumber} OR ("modelNumber" = ${params.cursor.modelNumber} AND "id" > ${params.cursor.id}))`,
    );
  }
  const where = Prisma.join(conditions, " AND ");

  const page = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "PartRecord" WHERE ${where}
    ORDER BY "modelNumber" ASC, "id" ASC
    LIMIT ${take + 1}
  `;
  const hasMore = page.length > take;
  const pageIds = page.slice(0, take).map((r) => r.id);
  if (pageIds.length === 0) return { rows: [], nextCursor: null };

  const records = await prisma.partRecord.findMany({
    where: { id: { in: pageIds } },
    include: { applianceType: { select: { name: true } } },
  });
  const byId = new Map(records.map((r) => [r.id, r]));
  const finance = actor.role === "OWNER" || actor.role === "ADMIN";

  const rows: PartListRow[] = pageIds.map((id) => {
    const r = byId.get(id)!;
    const base: PartListRow = {
      id: r.id,
      modelNumber: r.modelNumber,
      manufacturer: r.manufacturer,
      partNumber: r.partNumber,
      partName: r.partName,
      notes: r.notes,
      applianceTypeId: r.applianceTypeId,
      applianceTypeName: r.applianceType?.name ?? null,
      quantityOnHand: r.quantityOnHand,
      reorderThreshold: r.reorderThreshold,
      lowStock: r.reorderThreshold !== null && r.quantityOnHand <= r.reorderThreshold,
      archived: r.archivedAt !== null,
      sellable: r.sellable,
    };
    if (finance) {
      base.retailPriceCents = r.retailPriceCents;
      base.resaleCostOnHandCents = r.resaleCostOnHandCents;
      base.resaleUnitsOnHand = r.resaleUnitsOnHand;
      base.averageResaleCostCents =
        r.resaleUnitsOnHand > 0 ? Math.round(r.resaleCostOnHandCents / r.resaleUnitsOnHand) : null;
      base.defaultForResale = r.defaultForResale;
    }
    return base;
  });

  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor: hasMore && last ? { modelNumber: last.modelNumber, id: last.id } : null,
  };
}

/** Active appliance types for the Parts page's Type filter (the fleet
 * read's option shape; parts filter by type id, not slug). */
export async function getPartsTypeOptions(
  actor: PartsActor,
): Promise<{ id: string; name: string }[]> {
  if (!TEAM.includes(actor.role)) {
    throw new Error("Only the team can see parts.");
  }
  return prisma.applianceType.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}
