import { allocateAssetNumbers, buildAssetNumber } from "./asset-numbers";
import { jobPartsCosts } from "@/domains/purchasing/ledger";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import type { ApplianceStatus } from "@prisma/client";
import { assertStatusChangeKeepsCustody } from "./custody";
import {
  ALL_APPLIANCE_STATUSES,
  canTransitionApplianceStatus,
} from "./lifecycle";
import {
  computeApplianceRevenueCents,
  computeProfitability,
  computeRepairCostCents,
  computeUtilizationFraction,
  type AssignmentPeriod,
  type ProfitabilitySummary,
} from "./analytics";

// ---------------------------------------------------------------------------
// Inventory — individual physical Appliance units (as opposed to
// ApplianceType, which is a *category* like "Washer" with a public price).
// See docs/BUSINESS-RULES.md ("Inventory & status rules") and
// docs/ROADMAP.md (this was deferred from Phase 3's first slice).
// ---------------------------------------------------------------------------

// The status rules themselves live in ./lifecycle.ts (pure, no database
// import, shared with client components) — re-exported here so existing
// server callers and tests keep importing from "@/domains/inventory".
export {
  canTransitionApplianceStatus,
  ALLOWED_APPLIANCE_TRANSITIONS,
  APPLIANCE_STATUS_LABELS,
} from "./lifecycle";

/** Thrown by updateApplianceDetails/updateApplianceStatus when the record
 * changed since the caller last read it — see the "optimistic concurrency"
 * comment on updateApplianceDetails below. A distinct class (rather than a
 * plain Error) so callers can tell this apart from an ordinary validation
 * failure if they ever need to. */
export class ApplianceConflictError extends Error {
  constructor() {
    super(
      "Someone else changed this appliance just now — reload the page to see their update before saving yours.",
    );
    this.name = "ApplianceConflictError";
  }
}

/** Pure — turns an appliance type's name into a short asset-number prefix,
 * e.g. "Washer" -> "WASH", "Washer + Dryer Set" -> "WDS". Exported for
 * testing (tests/inventory.test.ts). */
export function assetNumberPrefix(applianceTypeName: string): string {
  const words = applianceTypeName.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (words.length === 0) {
    return "APPL";
  }
  if (words.length === 1) {
    return words[0].slice(0, 4).toUpperCase();
  }
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 6)
    .toUpperCase();
}

export { buildAssetNumber };

export async function getApplianceCountsByStatus(): Promise<
  Record<ApplianceStatus, number>
> {
  const counts = await prisma.appliance.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const result = Object.fromEntries(
    ALL_APPLIANCE_STATUSES.map((s) => [s, 0]),
  ) as Record<ApplianceStatus, number>;
  for (const row of counts) {
    result[row.status] = row._count._all;
  }
  return result;
}

export async function getAppliances(filter?: { status?: ApplianceStatus }) {
  return prisma.appliance.findMany({
    where: filter?.status ? { status: filter.status } : undefined,
    include: { applianceType: true },
    orderBy: [{ createdAt: "desc" }],
  });
}

/** How many appliances match a status filter — used to clamp the page
 * number for /desk/inventory's own paginated list before fetching that
 * page's rows (src/domains/pagination.ts). */
export async function getAppliancesCount(filter?: {
  status?: ApplianceStatus;
}): Promise<number> {
  return prisma.appliance.count({
    where: filter?.status ? { status: filter.status } : undefined,
  });
}

/** Paginated variant of getAppliances for /desk/inventory's own list, as
 * the fleet grows past a page. getAppliances() above stays unpaginated
 * for the callers that need every matching unit at once (the rental
 * builder wizard's/agreement page's "available appliances" picker). */
export async function getAppliancesPage(
  filter: { status?: ApplianceStatus } | undefined,
  skip: number,
  pageSize: number,
) {
  return prisma.appliance.findMany({
    where: filter?.status ? { status: filter.status } : undefined,
    select: {
      id: true,
      assetNumber: true,
      status: true,
      manufacturer: true,
      model: true,
      color: true,
      currentLocation: true,
      applianceType: { select: { name: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    skip,
    take: pageSize,
  });
}

export async function getApplianceById(id: string) {
  await requireRole("OWNER", "ADMIN");
  return prisma.appliance.findUnique({
    where: { id },
    include: {
      applianceType: true,
      // This unit's own photos (2026-09-28) — distinct from
      // ApplianceType.photoUrl, which is one generic stock photo for the
      // whole category. This is e.g. an actual scratch or scuff on *this*
      // physical washer, not what a clean one looks like.
      photos: { orderBy: [{ createdAt: "asc" }] },
    },
  });
}

export type NewApplianceUnitInput = {
  applianceTypeId: string;
  quantity: number;
  manufacturer?: string | null;
  model?: string | null;
  /** Only meaningful when quantity is 1 — units added in bulk almost
   * always have different serial numbers, so the caller should add those
   * individually afterward rather than stamping the same one on every
   * unit. */
  serialNumber?: string | null;
  color?: string | null;
  /** Free-form descriptive tags — e.g. "front-load", "top-load",
   * "agitator" for a washer, or whatever's relevant to a different
   * appliance type. Deliberately not an enum/fixed column list (see
   * migration comment in prisma/migrations) so a brand-new category or
   * an unanticipated feature never needs a schema change. */
  features?: string[];
  condition?: string | null;
  purchaseDate?: Date | null;
  acquisitionCostCents?: number | null;
  currentLocation?: string | null;
  notes?: string | null;
};

/**
 * Adds one or more new physical appliance units of an existing category,
 * as Chris obtains them — per his request, the system needs to support
 * adding inventory over time, starting from zero. Each unit gets its own
 * auto-generated, human-readable asset number (e.g. "WASH-0001") and
 * starts life as AVAILABLE. Writes one AuditLog entry per unit created.
 */
export async function createApplianceUnits(
  userId: string,
  input: NewApplianceUnitInput,
) {
  const applianceType = await prisma.applianceType.findUniqueOrThrow({
    where: { id: input.applianceTypeId },
  });

  const prefix = assetNumberPrefix(applianceType.name);

  // One transaction: the counter, every unit and every audit row commit or roll back together.
  return prisma.$transaction(async (tx) => {
    const assetNumbers = await allocateAssetNumbers(tx, prefix, input.quantity);
    const created = [];
    for (const assetNumber of assetNumbers) {
      const unit = await tx.appliance.create({
        data: {
          assetNumber,
          applianceTypeId: input.applianceTypeId,
          manufacturer: input.manufacturer || null,
          model: input.model || null,
          serialNumber: input.quantity === 1 ? input.serialNumber || null : null,
          color: input.color || null,
          features:
            input.features && input.features.length > 0 ? input.features : [],
          condition: input.condition || null,
          purchaseDate: input.purchaseDate ?? null,
          acquisitionCostCents: input.acquisitionCostCents ?? null,
          currentLocation: input.currentLocation || null,
          notes: input.notes || null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: "appliance.unit.create",
          entityType: "Appliance",
          entityId: unit.id,
          newValue: {
            assetNumber: unit.assetNumber,
            applianceTypeId: input.applianceTypeId,
          },
        },
      });

      created.push(unit);
    }
    return created;
  });
}

export type ApplianceDetailsUpdate = Partial<{
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  color: string | null;
  features: string[];
  condition: string | null;
  currentLocation: string | null;
  notes: string | null;
}>;

/** Edits an existing unit's descriptive details — never its status (see
 * updateApplianceStatus) or asset number (permanent once assigned).
 *
 * Optimistic concurrency (2026-09-28, docs/DECISIONS.md): `expectedUpdatedAt`
 * is the appliance's `updatedAt` from whenever the caller loaded the edit
 * form. If someone else (Chris on another tab, or eventually a second
 * employee) saved a change to this same appliance in between, `updatedAt`
 * has moved on and this update touches zero rows instead of silently
 * overwriting their edit with a form that was filled out against stale
 * data — `ApplianceConflictError` is thrown instead so the UI can tell the
 * person to reload and try again. */
export async function updateApplianceDetails(
  userId: string,
  applianceId: string,
  update: ApplianceDetailsUpdate,
  expectedUpdatedAt: Date,
) {
  const result = await prisma.appliance.updateMany({
    where: { id: applianceId, updatedAt: expectedUpdatedAt },
    data: update,
  });

  if (result.count === 0) {
    throw new ApplianceConflictError();
  }

  const updated = await prisma.appliance.findUniqueOrThrow({
    where: { id: applianceId },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "appliance.unit.update",
      entityType: "Appliance",
      entityId: applianceId,
      newValue: update,
    },
  });

  return updated;
}

/** Changes one appliance unit's status, enforcing the allowed-transition
 * rules server-side (see canTransitionApplianceStatus above) — never
 * trust a button being disabled in the UI as the real gate.
 *
 * Also closes a real race (2026-09-28, docs/DECISIONS.md): the status
 * check above reads `before.status`, but without a concurrency guard two
 * near-simultaneous status changes could both read the same starting
 * status, both pass canTransitionApplianceStatus, and both write —
 * silently letting the second one win over the first with neither side
 * ever finding out about the other's change. Conditioning the write on
 * `updatedAt` still matching what was just read closes that window: the
 * loser gets ApplianceConflictError and has to re-check the (now current)
 * status instead of overwriting blind. */
export async function updateApplianceStatus(
  userId: string,
  applianceId: string,
  newStatus: ApplianceStatus,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.appliance.findUniqueOrThrow({
      where: { id: applianceId },
    });

    const check = canTransitionApplianceStatus(before.status, newStatus);
    if (!check.ok) {
      throw new Error(check.reason);
    }

    await assertStatusChangeKeepsCustody(tx, applianceId, newStatus);

    const result = await tx.appliance.updateMany({
      where: { id: applianceId, updatedAt: before.updatedAt },
      data: { status: newStatus },
    });

    if (result.count === 0) {
      throw new ApplianceConflictError();
    }

    const updated = await tx.appliance.findUniqueOrThrow({
      where: { id: applianceId },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "appliance.unit.status",
        entityType: "Appliance",
        entityId: applianceId,
        oldValue: { status: before.status },
        newValue: { status: newStatus },
      },
    });

    return updated;
  });
}

/** Adds a photo of this specific physical unit — e.g. an actual scratch
 * on the real machine, not the generic stock photo on its ApplianceType.
 * The URL comes from a real upload (see PhotoUploadField), same as a
 * job's condition photos (src/domains/jobs/index.ts's addJobPhoto). */
export async function addAppliancePhoto(
  userId: string,
  applianceId: string,
  input: { url: string; altText?: string | null },
) {
  const photo = await prisma.photo.create({
    data: { applianceId, url: input.url, altText: input.altText || null },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "appliance.unit.photo.add",
      entityType: "Appliance",
      entityId: applianceId,
    },
  });

  return photo;
}

export type BulkStatusResult = {
  updated: string[];
  skipped: { applianceId: string; reason: string }[];
};

/** Bulk "set status" from the inventory list's multi-select (Task #44's
 * bulk actions) — e.g. marking several units Retired at once instead of
 * opening each one individually. Deliberately NOT one all-or-nothing
 * transaction: each appliance is checked and updated on its own through
 * the exact same updateApplianceStatus used everywhere else, so a
 * selection that mixes valid and invalid transitions (e.g. one already-
 * retired unit accidentally included) still applies to everything that
 * *can* move, and reports back exactly what didn't and why, rather than
 * failing the whole batch over one bad row. */
export async function bulkUpdateApplianceStatus(
  userId: string,
  applianceIds: string[],
  newStatus: ApplianceStatus,
): Promise<BulkStatusResult> {
  const result: BulkStatusResult = { updated: [], skipped: [] };
  for (const applianceId of applianceIds) {
    try {
      await updateApplianceStatus(userId, applianceId, newStatus);
      result.updated.push(applianceId);
    } catch (error) {
      result.skipped.push({
        applianceId,
        reason:
          error instanceof Error
            ? error.message
            : "Couldn't update this appliance.",
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Parts catalog — a small parts knowledge base keyed by MODEL NUMBER, not by
// an individual physical Appliance. Once Chris looks up a part for a given
// model, it's reusable for every unit of that model he ever owns, not just
// the one unit he was repairing when he found it. See the migration comment
// in prisma/migrations/20260926200000_appliance_features_color_parts for the
// full rationale.
// ---------------------------------------------------------------------------

/** Case-insensitive on purpose — model numbers get typed in by hand and
 * capitalization is inconsistent (e.g. "wfw5620hw0" vs "WFW5620HW0"). */
export async function getPartRecordsForModel(modelNumber: string) {
  return prisma.partRecord.findMany({
    where: { modelNumber: { equals: modelNumber, mode: "insensitive" }, archivedAt: null },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function getAllPartRecords(options: { includeArchived?: boolean } = {}) {
  return prisma.partRecord.findMany({
    where: options.includeArchived ? {} : { archivedAt: null },
    include: { applianceType: true },
    orderBy: [{ modelNumber: "asc" }, { createdAt: "desc" }],
  });
}

export type NewPartRecordInput = {
  modelNumber: string;
  manufacturer?: string | null;
  applianceTypeId?: string | null;
  partNumber: string;
  partName?: string | null;
  notes?: string | null;
};

/** Logs a part number against a model number for future reuse. Not tied to
 * any single physical Appliance — that's the whole point (see above). */
export async function createPartRecord(
  userId: string,
  input: NewPartRecordInput,
) {
  const record = await prisma.partRecord.create({
    data: {
      modelNumber: input.modelNumber,
      manufacturer: input.manufacturer || null,
      applianceTypeId: input.applianceTypeId || null,
      partNumber: input.partNumber,
      partName: input.partName || null,
      notes: input.notes || null,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "part.create",
      entityType: "PartRecord",
      entityId: record.id,
      newValue: {
        modelNumber: record.modelNumber,
        partNumber: record.partNumber,
      },
    },
  });

  return record;
}

/**
 * Deletes a part that was only a typo. A part with any stock history (a movement) or any purchase
 * order line cannot be deleted, only archived, so its history stays readable.
 */
export async function deletePartRecord(userId: string, partRecordId: string) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "PartRecord" WHERE "id" = ${partRecordId} FOR UPDATE`;
    const [movements, orderLines] = await Promise.all([
      tx.partStockMovement.count({ where: { partRecordId } }),
      tx.purchaseOrderLineItem.count({ where: { partRecordId } }),
    ]);
    if (movements > 0 || orderLines > 0) {
      throw new Error("This part has stock or order history, so it can't be deleted. Archive it instead.");
    }
    const record = await tx.partRecord.delete({ where: { id: partRecordId } });
    await tx.auditLog.create({
      data: {
        userId,
        action: "part.delete",
        entityType: "PartRecord",
        entityId: partRecordId,
        oldValue: {
          modelNumber: record.modelNumber,
          partNumber: record.partNumber,
        },
      },
    });
    return record;
  });
}

// ---------------------------------------------------------------------------
// Fleet utilization + appliance profitability/ROI (2026-09-27) — see
// src/domains/inventory/analytics.ts for the pure math, and
// docs/DECISIONS.md for how revenue/utilization are estimated from real
// assignment dates and agreed pricing (not exact invoiced amounts).
// ---------------------------------------------------------------------------

export type ApplianceProfitability = ProfitabilitySummary & {
  applianceId: string;
  assetNumber: string;
  applianceTypeName: string;
  status: ApplianceStatus;
  utilizationFraction: number;
  acquisitionCostRecorded: boolean;
  incompleteRepairJobIds: string[];
};

/** Builds estimates for every non-archived appliance in three bulk queries.
 * Pagination bounds the report UI, not the underlying fleet calculation. */
export async function getFleetAnalytics(asOf = new Date()): Promise<{
  asOf: Date;
  appliances: ApplianceProfitability[];
  totals: {
    applianceCount: number;
    totalInvestedCents: number;
    totalRevenueCents: number;
    totalRepairCostCents: number;
    totalNetContributionCents: number;
    paidForItselfCount: number;
    averageUtilizationFraction: number;
    incompleteCostCount: number;
  };
}> {
  await requireRole("OWNER", "ADMIN");

  const [appliances, assignments, repairJobAppliances] = await Promise.all([
    prisma.appliance.findMany({
      where: { archivedAt: null },
      include: { applianceType: { select: { name: true } } },
      orderBy: [{ assetNumber: "asc" }],
    }),
    prisma.applianceAssignment.findMany({
      select: {
        applianceId: true,
        rentalLineId: true,
        assignedAt: true,
        unassignedAt: true,
        rentalLine: { select: { monthlyPriceCents: true } },
      },
    }),
    prisma.jobAppliance.findMany({
      where: {
        job: { status: "COMPLETED", type: "MAINTENANCE_VISIT" },
      },
      select: {
        applianceId: true,
        job: {
          select: { id: true, partsCostCents: true, laborCostCents: true },
        },
      },
    }),
  ]);

  // How many distinct appliances have ever shared each rental line — used
  // to split that line's monthly price evenly across them (see
  // AssignmentPeriod.applianceCountOnLine in analytics.ts).
  const lineApplianceIds = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = lineApplianceIds.get(a.rentalLineId) ?? new Set<string>();
    set.add(a.applianceId);
    lineApplianceIds.set(a.rentalLineId, set);
  }

  const assignmentsByAppliance = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = assignmentsByAppliance.get(a.applianceId) ?? [];
    list.push(a);
    assignmentsByAppliance.set(a.applianceId, list);
  }

  // A job with itemized parts-ledger usage uses those costs instead of the hand-entered number (never both).
  const partsCosts = await jobPartsCosts(prisma, [...new Set(repairJobAppliances.map((ja) => ja.job.id))]);
  const repairCostByAppliance = new Map<
    string,
    {
      id: string;
      partsCostCents: number | null;
      laborCostCents: number | null;
      partsUnknownLines: number;
    }[]
  >();
  for (const ja of repairJobAppliances) {
    const list = repairCostByAppliance.get(ja.applianceId) ?? [];
    const parts = partsCosts.get(ja.job.id);
    list.push({
      id: ja.job.id,
      partsCostCents: parts && parts.source === "ITEMIZED" ? parts.cents : ja.job.partsCostCents,
      laborCostCents: ja.job.laborCostCents,
      partsUnknownLines: parts?.unknownCostLines ?? 0,
    });
    repairCostByAppliance.set(ja.applianceId, list);
  }

  const results: ApplianceProfitability[] = appliances.map((appliance) => {
    const applianceAssignments = assignmentsByAppliance.get(appliance.id) ?? [];

    const periods: AssignmentPeriod[] = applianceAssignments.map((a) => ({
      assignedAt: a.assignedAt,
      unassignedAt: a.unassignedAt,
      monthlyPriceCents: a.rentalLine.monthlyPriceCents,
      applianceCountOnLine: lineApplianceIds.get(a.rentalLineId)?.size ?? 1,
    }));

    const revenueCents = computeApplianceRevenueCents(periods, asOf);
    const repairCostCents = computeRepairCostCents(
      repairCostByAppliance.get(appliance.id) ?? [],
    );
    const utilizationFraction = computeUtilizationFraction(
      applianceAssignments,
      appliance.createdAt,
      asOf,
    );
    const profitability = computeProfitability({
      revenueCents,
      repairCostCents,
      acquisitionCostCents: appliance.acquisitionCostCents,
    });
    const acquisitionCostRecorded = appliance.acquisitionCostCents !== null;
    const incompleteRepairJobIds = (
      repairCostByAppliance.get(appliance.id) ?? []
    )
      .filter(
        (job) => job.partsCostCents === null || job.laborCostCents === null || job.partsUnknownLines > 0,
      )
      .map((job) => job.id);

    return {
      ...profitability,
      // A zero explicitly entered is known; a blank is not proof of cost recovery.
      paidForItself:
        profitability.paidForItself &&
        acquisitionCostRecorded &&
        incompleteRepairJobIds.length === 0,
      acquisitionCostRecorded,
      incompleteRepairJobIds,
      applianceId: appliance.id,
      assetNumber: appliance.assetNumber,
      applianceTypeName: appliance.applianceType.name,
      status: appliance.status,
      utilizationFraction,
    };
  });

  const totals = results.reduce(
    (acc, r) => {
      acc.totalInvestedCents += r.acquisitionCostCents;
      acc.totalRevenueCents += r.revenueCents;
      acc.totalRepairCostCents += r.repairCostCents;
      acc.totalNetContributionCents += r.netContributionCents;
      if (r.paidForItself) acc.paidForItselfCount += 1;
      acc.utilizationSum += r.utilizationFraction;
      return acc;
    },
    {
      totalInvestedCents: 0,
      totalRevenueCents: 0,
      totalRepairCostCents: 0,
      totalNetContributionCents: 0,
      paidForItselfCount: 0,
      utilizationSum: 0,
    },
  );

  return {
    asOf,
    appliances: results,
    totals: {
      applianceCount: results.length,
      totalInvestedCents: totals.totalInvestedCents,
      totalRevenueCents: totals.totalRevenueCents,
      totalRepairCostCents: totals.totalRepairCostCents,
      totalNetContributionCents: totals.totalNetContributionCents,
      paidForItselfCount: totals.paidForItselfCount,
      averageUtilizationFraction:
        results.length > 0 ? totals.utilizationSum / results.length : 0,
      incompleteCostCount: results.filter(
        (r) =>
          !r.acquisitionCostRecorded || r.incompleteRepairJobIds.length > 0,
      ).length,
    },
  };
}

/** One appliance's own profitability/ROI — same math as getFleetAnalytics,
 * scoped to a single unit, for the "Profitability" panel on its detail
 * page (/desk/inventory/[id]). */
export async function getApplianceProfitability(
  applianceId: string,
): Promise<ApplianceProfitability | null> {
  const { appliances } = await getFleetAnalytics();
  return appliances.find((a) => a.applianceId === applianceId) ?? null;
}
