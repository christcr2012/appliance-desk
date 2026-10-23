import { prisma } from "@/lib/prisma";
import { assertCapability } from "@/domains/capabilities";
import { updateAppliancePriceInTx } from "@/domains/settings";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

/**
 * Price changes with a start date (Batch O-4, design D-O4).
 *
 * The owner (or an admin who may change settings) picks an appliance type, a new monthly price and a Colorado start day.
 * A nightly job applies each due change once, through the same price save as the Settings screen, so the history and
 * audit rows look the same. Nothing about signed agreements changes: an agreement keeps the price it was signed at, and
 * a sent estimate keeps the price on its lines. Only prices shown and quoted from the start day on are new.
 */
export const MAX_SCHEDULED_PRICE_CENTS = 1_000_000; // $10,000 a month is far above any real appliance rent.
export const MAX_DAYS_AHEAD = 366;
const PAGE = 50;
const MAX_PASSES = 40; // up to 2,000 changes in one night

export type ScheduleInput = {
  applianceTypeId: string;
  newPriceCents: number;
  /** Colorado calendar day, YYYY-MM-DD. Must be after today. */
  effectiveOn: string;
  note?: string;
};

/** Calendar arithmetic on a YYYY-MM-DD key, so daylight-saving days (23 or 25 hours long) cannot throw it off. */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The earliest start day the screen offers (tomorrow, Colorado calendar). */
export function earliestStartDay(now: Date = new Date()): string {
  return addDaysToKey(businessDateKey(now), 1);
}

/** Pure rule so the screen and the domain agree. Returns a plain-words problem or null. */
export function scheduleInputProblem(input: ScheduleInput, now: Date = new Date()): string | null {
  if (!Number.isInteger(input.newPriceCents) || input.newPriceCents < 0) return "Enter a valid price.";
  if (input.newPriceCents > MAX_SCHEDULED_PRICE_CENTS) return "That price is higher than $10,000 a month. Check the amount.";
  const day = businessDateFromKey(input.effectiveOn);
  if (!day) return "Pick a valid start date.";
  const today = businessDateKey(now);
  if (input.effectiveOn <= today) return "The start date must be after today. To change a price right now, use the price on the Settings screen.";
  const last = addDaysToKey(today, MAX_DAYS_AHEAD);
  if (input.effectiveOn > last) return "Pick a start date within the next year.";
  if ((input.note ?? "").length > 300) return "Keep the note under 300 characters.";
  return null;
}

export async function scheduleAppliancePriceChange(actorId: string, input: ScheduleInput, now: Date = new Date()) {
  const problem = scheduleInputProblem(input, now);
  if (problem) throw new Error(problem);
  const effectiveOn = businessDateFromKey(input.effectiveOn)!;
  const note = input.note?.trim() || null;

  return prisma.$transaction(async (tx) => {
    await assertCapability(tx, actorId, "EDIT_SETTINGS");
    await tx.$queryRaw`SELECT "id" FROM "ApplianceType" WHERE "id" = ${input.applianceTypeId} FOR UPDATE`;
    const type = await tx.applianceType.findUnique({ where: { id: input.applianceTypeId } });
    if (!type) throw new Error("Couldn't find that appliance type.");
    if (!type.isActive) throw new Error("That appliance type is retired. Pick one that is in use.");

    const existing = await tx.scheduledPriceChange.findFirst({
      where: { applianceTypeId: type.id, status: "PENDING", effectiveOn },
      select: { id: true },
    });
    if (existing) throw new Error("There is already a price change scheduled for that day. Cancel it first if you want a different price.");

    const row = await tx.scheduledPriceChange.create({
      data: {
        applianceTypeId: type.id,
        newPriceCents: input.newPriceCents,
        effectiveOn,
        note,
        priceAtSchedulingCents: type.monthlyPriceCents,
        createdByUserId: actorId,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "pricing.schedule",
        entityType: "ApplianceType",
        entityId: type.id,
        newValue: { scheduledChangeId: row.id, newPriceCents: input.newPriceCents, effectiveOn: input.effectiveOn, priceAtSchedulingCents: type.monthlyPriceCents },
      },
    });
    return row;
  });
}

export async function cancelScheduledPriceChange(actorId: string, changeId: string, now: Date = new Date()) {
  return prisma.$transaction(async (tx) => {
    await assertCapability(tx, actorId, "EDIT_SETTINGS");
    const rows = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT "status" FROM "ScheduledPriceChange" WHERE "id" = ${changeId} FOR UPDATE`;
    const current = rows[0];
    if (!current) throw new Error("Couldn't find that price change.");
    if (current.status !== "PENDING") throw new Error("That price change has already been applied or cancelled, so it can't be cancelled now.");
    const row = await tx.scheduledPriceChange.update({
      where: { id: changeId },
      data: { status: "CANCELLED", cancelledByUserId: actorId, cancelledAt: now },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "pricing.schedule_cancel",
        entityType: "ApplianceType",
        entityId: row.applianceTypeId,
        newValue: { scheduledChangeId: row.id },
      },
    });
    return row;
  });
}

export type ScheduledPriceRow = {
  id: string;
  applianceTypeId: string;
  applianceTypeName: string;
  currentPriceCents: number;
  newPriceCents: number;
  effectiveOn: Date;
  status: "PENDING" | "APPLIED" | "CANCELLED" | "FAILED";
  note: string | null;
  failureMessage: string | null;
  appliedAt: Date | null;
};

type RowWithType = {
  id: string; applianceTypeId: string; newPriceCents: number; effectiveOn: Date; status: ScheduledPriceRow["status"];
  note: string | null; failureMessage: string | null; appliedAt: Date | null;
  applianceType: { name: string; monthlyPriceCents: number };
};

function toRow(r: RowWithType): ScheduledPriceRow {
  return {
    id: r.id, applianceTypeId: r.applianceTypeId, applianceTypeName: r.applianceType.name,
    currentPriceCents: r.applianceType.monthlyPriceCents, newPriceCents: r.newPriceCents, effectiveOn: r.effectiveOn,
    status: r.status, note: r.note, failureMessage: r.failureMessage, appliedAt: r.appliedAt,
  };
}

const withType = { applianceType: { select: { name: true, monthlyPriceCents: true } } } as const;

/** Waiting changes (oldest start first) and the most recent finished ones. Bounded reads. */
export async function listScheduledPriceChanges(): Promise<{ pending: ScheduledPriceRow[]; recent: ScheduledPriceRow[] }> {
  const [pending, recent] = await Promise.all([
    prisma.scheduledPriceChange.findMany({
      where: { status: "PENDING" }, include: withType, orderBy: [{ effectiveOn: "asc" }, { id: "asc" }], take: PAGE,
    }),
    prisma.scheduledPriceChange.findMany({
      where: { status: { not: "PENDING" } }, include: withType, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20,
    }),
  ]);
  return { pending: pending.map(toRow), recent: recent.map(toRow) };
}

/** What the screen says before saving: how many quotes already out keep their price. */
export async function previewScheduledPriceChange(): Promise<{ openEstimates: number }> {
  const openEstimates = await prisma.estimate.count({
    where: { status: { in: ["SENT", "VIEWED", "APPROVED", "CHANGES_REQUESTED"] } },
  });
  return { openEstimates };
}

function plainFailure(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : "Unknown problem";
  return raw.replace(/https?:\/\/\S+/gi, "[link]").slice(0, 300);
}

async function applyBatch(ids: string[], now: Date): Promise<{ applied: number; failed: number }> {
  let applied = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const ok = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT "status" FROM "ScheduledPriceChange" WHERE "id" = ${id} FOR UPDATE`;
        if (rows[0]?.status !== "PENDING") return false;
        const change = await tx.scheduledPriceChange.findUniqueOrThrow({ where: { id } });
        await assertCapability(tx, change.createdByUserId, "EDIT_SETTINGS");
        const type = await tx.applianceType.findUniqueOrThrow({ where: { id: change.applianceTypeId } });
        if (!type.isActive) throw new Error("That appliance type has been retired, so its price was left alone.");
        await updateAppliancePriceInTx(tx, change.createdByUserId, change.applianceTypeId, change.newPriceCents, {
          scheduledChangeId: change.id,
        });
        await tx.scheduledPriceChange.update({
          where: { id },
          data: { status: "APPLIED", appliedAt: now, priceBeforeApplyCents: type.monthlyPriceCents },
        });
        return true;
      });
      if (ok) applied += 1;
    } catch (cause) {
      failed += 1;
      const message = plainFailure(cause);
      await prisma.scheduledPriceChange.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "FAILED", failureMessage: message },
      });
    }
  }
  return { applied, failed };
}

/**
 * Nightly: apply every change whose start day has come, oldest first, once. Each change is its own transaction that
 * locks the change row, so a second run (or a cancel at the same moment) cannot apply it twice. The person who
 * scheduled it must still be allowed to change settings; if not, the change is marked FAILED with a plain reason and
 * the price is left alone (the owner can schedule it again).
 */
export async function applyDueScheduledPriceChanges(now: Date = new Date()): Promise<{ applied: number; failed: number }> {
  let applied = 0;
  let failed = 0;
  // Work through bounded batches until nothing due is left waiting. A row that fails becomes FAILED (no longer
  // PENDING), so every pass makes progress and the loop ends; the cap is only a safety net.
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const due = await prisma.scheduledPriceChange.findMany({
      where: { status: "PENDING", effectiveOn: { lte: now } },
      orderBy: [{ effectiveOn: "asc" }, { id: "asc" }],
      take: PAGE,
      select: { id: true },
    });
    if (due.length === 0) break;
    const counts = await applyBatch(due.map((r) => r.id), now);
    applied += counts.applied;
    failed += counts.failed;
  }
  return { applied, failed };
}
