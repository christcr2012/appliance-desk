import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import {
  businessDateKey,
  businessDayBounds,
} from "@/lib/business-date";
import { isRuleKey, ruleDef, type RuleKey } from "./registry";
import { ruleAsOf, RuleMissingError } from "./reads";
import { saveRuleVersionInTx } from "./changes";

/**
 * TFA-3 (spec section 14): stored readings from the official-page parsers.
 * A reading is recorded once per business day, compared with the rule book,
 * and — when it differs — waits on the owner's To do. Nothing here ever
 * applies a reading: approve creates the version through the same writer
 * the Rules screen uses (origin OFFICIAL_WATCH, the stated date, and the
 * late-change true-up when that date has passed), and Not right dismisses
 * the reading so the same one never asks again.
 */

type Tx = Prisma.TransactionClient;

export type RuleObservationInput = {
  ruleKey: string;
  value: unknown;
  effectiveFrom: Date | null;
  watchId: string;
  evidence: string;
  observedAt?: Date;
};

/** Canonical JSON for comparing rule values regardless of key order. */
export function canonicalRuleValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalRuleValue).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalRuleValue(entry)}`).join(",")}}`;
}

function readingKey(ruleKey: string, value: unknown, effectiveFrom: Date | null): string {
  return `${ruleKey}|${canonicalRuleValue(value)}|${effectiveFrom ? businessDateKey(effectiveFrom) : "no-date"}`;
}

export async function recordRuleObservationInTx(
  tx: Tx,
  input: RuleObservationInput,
): Promise<{ id: string }> {
  if (!isRuleKey(input.ruleKey)) throw new Error("Unknown tax rule.");
  ruleDef(input.ruleKey).schema.parse(input.value);
  const observedAt = input.observedAt ?? new Date();
  const bounds = businessDayBounds(observedAt);

  const watch = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "OfficialSourceWatch" WHERE "id" = ${input.watchId} FOR UPDATE
  `;
  if (watch.length !== 1) throw new Error("Couldn't find that official source watch.");

  const sameDay = await tx.legalRuleObservation.findMany({
    where: {
      ruleKey: input.ruleKey,
      watchId: input.watchId,
      observedAt: { gte: bounds.start, lt: bounds.end },
    },
    select: { id: true, value: true, effectiveFrom: true },
    orderBy: { id: "asc" },
  });
  const wanted = canonicalRuleValue(input.value);
  const existing = sameDay.find(
    (row) =>
      canonicalRuleValue(row.value) === wanted &&
      (row.effectiveFrom?.getTime() ?? null) === (input.effectiveFrom?.getTime() ?? null),
  );
  if (existing) return existing;

  return tx.legalRuleObservation.create({
    data: {
      ruleKey: input.ruleKey,
      value: input.value as Prisma.InputJsonValue,
      effectiveFrom: input.effectiveFrom,
      watchId: input.watchId,
      evidence: input.evidence.slice(0, 1000),
      observedAt,
    },
    select: { id: true },
  });
}

/**
 * How far a reading may sit from the current value before the To do calls
 * it unusually large. Deliberately generous: the flag only changes the
 * wording ("check carefully"), never whether the item appears.
 */
export function isPlausibleRuleChange(key: RuleKey, current: unknown, next: unknown): boolean {
  if (current === null || current === undefined) return true;
  switch (key) {
    case "co.rdf.amount":
      return typeof next === "number" && Math.abs(next - (current as number)) <= 10;
    case "greeley.sales_rate":
      return typeof next === "number" && Math.abs(next - (current as number)) <= 200;
    case "us.1099.threshold": {
      const base = current as number;
      return typeof next === "number" && next >= base / 4 && next <= base * 4;
    }
    case "co.interest": {
      const before = current as { regular: number; discounted: number };
      const after = next as { regular: number; discounted: number };
      return Math.abs(after.regular - before.regular) <= 5 &&
        Math.abs(after.discounted - before.discounted) <= 5;
    }
    default:
      return true;
  }
}

export type RuleChangeAttentionItem = {
  observationId: string;
  ruleKey: RuleKey;
  value: unknown;
  effectiveFrom: Date | null;
  evidence: string;
  watchUrl: string;
  readOnTwoDays: boolean;
  plausible: boolean;
  startPassed: boolean;
  since: Date;
};

/** The readings that differ from the rule book and still wait for the owner. */
export async function listRuleChangeAttention(
  now = new Date(),
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<RuleChangeAttentionItem[]> {
  const observations = await db.legalRuleObservation.findMany({
    where: { dismissedAt: null, approvedVersionId: null },
    select: {
      id: true, ruleKey: true, value: true, effectiveFrom: true,
      evidence: true, observedAt: true, watchId: true,
    },
    orderBy: [{ observedAt: "asc" }, { id: "asc" }],
  });
  if (observations.length === 0) return [];

  // A reading that was already dismissed or approved under any watch row
  // is settled: the same value for the same rule and date never re-asks.
  const settled = await db.legalRuleObservation.findMany({
    where: { OR: [{ dismissedAt: { not: null } }, { approvedVersionId: { not: null } }] },
    select: { ruleKey: true, value: true, effectiveFrom: true },
  });
  const settledKeys = new Set(settled.map((row) => readingKey(row.ruleKey, row.value, row.effectiveFrom)));

  const watches = await db.officialSourceWatch.findMany({
    where: { id: { in: [...new Set(observations.map((row) => row.watchId))] } },
    select: { id: true, url: true },
  });
  const watchUrl = new Map(watches.map((watch) => [watch.id, watch.url]));

  // Latest observation per (rule, date); agreement = the same reading
  // (same value) seen on two different business days.
  const groups = new Map<string, typeof observations>();
  for (const row of observations) {
    const groupKey = `${row.ruleKey}|${row.effectiveFrom ? businessDateKey(row.effectiveFrom) : "no-date"}`;
    const group = groups.get(groupKey) ?? [];
    group.push(row);
    groups.set(groupKey, group);
  }

  const items: RuleChangeAttentionItem[] = [];
  for (const group of groups.values()) {
    const latest = group[group.length - 1]!;
    if (!isRuleKey(latest.ruleKey)) continue;
    const key = latest.ruleKey;
    if (settledKeys.has(readingKey(key, latest.value, latest.effectiveFrom))) continue;

    const sameReadingDays = new Set(
      group
        .filter((row) => canonicalRuleValue(row.value) === canonicalRuleValue(latest.value))
        .map((row) => businessDateKey(row.observedAt)),
    );

    let current: unknown = null;
    let differs = false;
    if (latest.effectiveFrom) {
      const sameDate = await db.legalRuleVersion.findMany({
        where: { ruleKey: key, effectiveFrom: latest.effectiveFrom, undoneAt: null },
        select: { value: true },
      });
      if (sameDate.some((row) => canonicalRuleValue(row.value) === canonicalRuleValue(latest.value))) {
        continue;
      }
      // Compare against the rule in force on the reading's own date,
      // never today's rule: a correction to a past period must still
      // ask, even when today's value already matches the corrected one.
      try {
        const asOf = await ruleAsOf(key, latest.effectiveFrom, db as typeof prisma);
        current = asOf.value;
        differs = canonicalRuleValue(asOf.value) !== canonicalRuleValue(latest.value);
      } catch (error) {
        if (!(error instanceof RuleMissingError)) throw error;
        differs = true;
      }
    } else {
      try {
        const asOf = await ruleAsOf(key, now, db as typeof prisma);
        current = asOf.value;
        differs = canonicalRuleValue(asOf.value) !== canonicalRuleValue(latest.value);
      } catch (error) {
        if (!(error instanceof RuleMissingError)) throw error;
        differs = true;
      }
    }
    if (!differs) continue;

    items.push({
      observationId: latest.id,
      ruleKey: key,
      value: latest.value,
      effectiveFrom: latest.effectiveFrom,
      evidence: latest.evidence,
      watchUrl: watchUrl.get(latest.watchId) ?? "",
      readOnTwoDays: sameReadingDays.size >= 2,
      plausible: isPlausibleRuleChange(key, current, latest.value),
      startPassed: latest.effectiveFrom !== null && latest.effectiveFrom.getTime() <= now.getTime(),
      since: latest.observedAt,
    });
  }

  return items.sort((a, b) => {
    const aKey = a.effectiveFrom ? businessDateKey(a.effectiveFrom) : "9999-99-99";
    const bKey = b.effectiveFrom ? businessDateKey(b.effectiveFrom) : "9999-99-99";
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
}

async function lockObservation(tx: Tx, observationId: string) {
  const rows = await tx.$queryRaw<Array<{
    id: string; ruleKey: string; value: unknown; effectiveFrom: Date | null;
    watchId: string; evidence: string; dismissedAt: Date | null; approvedVersionId: string | null;
  }>>`
    SELECT "id", "ruleKey", "value", "effectiveFrom", "watchId", "evidence", "dismissedAt", "approvedVersionId"
    FROM "LegalRuleObservation" WHERE "id" = ${observationId} FOR UPDATE
  `;
  const observation = rows[0];
  if (!observation) throw new Error("That reading was not found.");
  if (observation.dismissedAt) throw new Error("That reading was already marked not right.");
  if (observation.approvedVersionId) throw new Error("That reading was already approved.");
  return observation;
}

/**
 * Approve a reading: creates the rule version for the date the page
 * stated, never earlier, through the Rules writer (which runs the
 * late-change true-up in the same transaction when the date has passed).
 */
export async function approveRuleChange(
  observationId: string,
  actorUserId: string,
  now = new Date(),
): Promise<{ versionId: string }> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const observation = await lockObservation(tx, observationId);
    if (!isRuleKey(observation.ruleKey)) throw new Error("Unknown tax rule.");
    if (!observation.effectiveFrom) {
      throw new Error("This reading has no start date, so it cannot be approved yet. Enter the change on the Rules screen once the city states a date.");
    }
    const watch = await tx.officialSourceWatch.findUnique({
      where: { id: observation.watchId }, select: { url: true },
    });
    const { versionId } = await saveRuleVersionInTx(tx, actorUserId, {
      key: observation.ruleKey,
      value: observation.value,
      effectiveFrom: observation.effectiveFrom,
      reason: "Approved from the official page watch",
      origin: "OFFICIAL_WATCH",
    }, now);
    await tx.legalRuleVersion.update({
      where: { id: versionId },
      data: { sourceUrl: watch?.url ?? null, sourceQuote: observation.evidence.slice(0, 1000) },
    });
    await tx.legalRuleObservation.update({
      where: { id: observation.id },
      data: { approvedVersionId: versionId },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "rules.observation_approved",
        entityType: "LegalRuleObservation",
        entityId: observation.id,
        newValue: { versionId, ruleKey: observation.ruleKey },
      },
    });
    return { versionId };
  });
}

/** Not right: dismiss a reading with a note; the same reading never re-asks. */
export async function dismissRuleChange(
  observationId: string,
  actorUserId: string,
  note: string,
  now = new Date(),
): Promise<void> {
  const trimmed = note.trim();
  if (trimmed.length > 500) throw new Error("Keep the note under 500 characters.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const observation = await lockObservation(tx, observationId);
    await tx.legalRuleObservation.update({
      where: { id: observation.id },
      data: { dismissedAt: now, dismissNote: trimmed || null, dismissedByUserId: actorUserId },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "rules.observation_dismissed",
        entityType: "LegalRuleObservation",
        entityId: observation.id,
        newValue: { ruleKey: observation.ruleKey, note: trimmed || null },
      },
    });
  });
}
