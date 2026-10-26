import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { parseDollarInput } from "@/lib/money-ui";
import { cancelPendingDecisionChangesInTx } from "@/domains/decisions/pending";
import { isRuleKey, ruleDef, type RuleField, type RuleKey } from "./registry";
import { ruleAsOf, RuleMissingError } from "./reads";
import { trueUpLateChange, type TrueUpResult } from "./true-up";

/**
 * TFA-1: owner changes and undos of dated rule versions (TAX-FEE-AUTOPILOT
 * section 4). OWNER-only, audited, reason required. A change whose start
 * date has already passed is the late-change path: issued bills are never
 * rewritten; the true-up runs in the same transaction.
 */

type Tx = Prisma.TransactionClient;

/** Pending Decisions questions a rule change supersedes (mirrors the old setting saves). */
const CANCEL_ON_CHANGE: Partial<Record<RuleKey, string[]>> = {
  "co.rdf.qualified_threshold": ["IN-33", "IN-37"],
  "records.keep_years": ["IN-71"],
};

function lockSettings(tx: Tx): Promise<unknown> {
  return tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
}

/**
 * Build a rule value from the Change form's fields. Money fields arrive in
 * dollars and are stored as cents; the other fields keep their form text.
 * Missing fields keep the current value, so a partial form cannot blank a
 * property the screen did not show.
 */
export function buildRuleValueFromFields(
  // Only the fields and the schema are read here; the structural type keeps
  // every RuleDef<T> assignable (RuleDef itself is invariant in T).
  def: { fields: RuleField[]; schema: { parse: (value: unknown) => unknown } },
  form: Record<string, string | undefined>,
  current: unknown,
): unknown {
  const currentObj = current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown> : {};
  const isScalar = def.fields.length === 1 && def.fields[0]!.name === "value";
  const parsed: Record<string, unknown> = {};
  for (const field of def.fields) {
    const raw = form[field.name];
    if (raw === undefined || raw === "") {
      if (isScalar) throw new Error(`Enter ${field.label.toLowerCase()}.`);
      if (field.name in currentObj) { parsed[field.name] = currentObj[field.name]; continue; }
      throw new Error(`Enter ${field.label.toLowerCase()}.`);
    }
    if (field.kind === "money") {
      parsed[field.name] = parseDollarInput(raw, (field.max ?? 100000000) * 100);
    } else if (field.kind === "integer" || field.kind === "percent") {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`Enter a number for ${field.label.toLowerCase()}.`);
      if (field.kind === "integer" && !Number.isInteger(value)) throw new Error(`${field.label} must be a whole number.`);
      if (field.min !== undefined && value < field.min) throw new Error(`${field.label} must be at least ${field.min}.`);
      if (field.max !== undefined && value > field.max) throw new Error(`${field.label} must be at most ${field.max}.`);
      parsed[field.name] = value;
    } else {
      parsed[field.name] = raw.trim();
    }
  }
  const value = isScalar ? parsed.value : { ...currentObj, ...parsed };
  return def.schema.parse(value);
}

export async function saveRuleVersionInTx(
  tx: Tx,
  actorId: string,
  input: {
    key: string;
    value: unknown;
    effectiveFrom: Date;
    reason: string;
    origin?: "OWNER" | "PROFESSIONAL";
  },
  now: Date = new Date(),
): Promise<{ versionId: string; trueUp: TrueUpResult }> {
  if (!isRuleKey(input.key)) throw new Error("Unknown tax rule.");
  const def = ruleDef(input.key);
  const value = def.schema.parse(input.value);
  const reason = input.reason.trim();
  if (!reason) throw new Error("Give a reason for this change.");
  if (reason.length > 500) throw new Error("Keep the reason under 500 characters.");
  const effectiveKey = businessDateKey(input.effectiveFrom);
  const effectiveFrom = businessDateFromKey(effectiveKey);
  if (!effectiveFrom) throw new Error("Enter a valid start date.");
  await assertActiveTeamActor(tx, actorId, ["OWNER"]);
  await lockSettings(tx);

  let previous: { value: unknown; effectiveFrom: Date } | null = null;
  try {
    const current = await ruleAsOf(input.key, effectiveFrom, tx);
    previous = { value: current.value, effectiveFrom: current.version.effectiveFrom };
  } catch (error) {
    if (!(error instanceof RuleMissingError)) throw error;
  }

  // A second save for the same start date supersedes the earlier one: the
  // earlier version stays as history (undoneAt set) and the new one takes
  // its place. Without this the unique key blocks correcting a value that
  // was just entered, and an undone future change blocks its replacement
  // (Codex review on PR #617). The partial unique index only constrains
  // ACTIVE rows, so the supersede must happen before the insert.
  const superseded = await tx.legalRuleVersion.findMany({
    where: { ruleKey: input.key, effectiveFrom, origin: input.origin ?? "OWNER", undoneAt: null },
    select: { id: true },
  });
  for (const old of superseded) {
    await tx.legalRuleVersion.update({ where: { id: old.id }, data: { undoneAt: now } });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "rules.supersede",
        entityType: "LegalRuleVersion",
        entityId: old.id,
        oldValue: { ruleKey: input.key, effectiveFrom: effectiveKey },
        newValue: { undoneAt: now.toISOString(), reason: "Superseded by a newer value for the same start date." },
      },
    });
  }

  const version = await tx.legalRuleVersion.create({
    data: {
      ruleKey: input.key,
      value: value as object,
      effectiveFrom,
      origin: input.origin ?? "OWNER",
      provisional: false,
      autoApplied: false,
      createdByUserId: actorId,
    },
    select: { id: true },
  });
  await tx.auditLog.create({
    data: {
      userId: actorId,
      action: "rules.change",
      entityType: "LegalRuleVersion",
      entityId: version.id,
      oldValue: previous ? { value: previous.value as Prisma.InputJsonValue, effectiveFrom: previous.effectiveFrom.toISOString() } : Prisma.JsonNull,
      newValue: { ruleKey: input.key, value, effectiveFrom: effectiveKey, reason, origin: input.origin ?? "OWNER" },
    },
  });
  for (const subjectId of CANCEL_ON_CHANGE[input.key] ?? []) {
    await cancelPendingDecisionChangesInTx(tx, actorId, [subjectId], "A newer rule value was saved.");
  }

  let trueUp: TrueUpResult = { recordsExamined: 0, recordsChanged: 0, absorbedCents: 0, creditedCents: 0, credits: [] };
  if (effectiveFrom.getTime() <= now.getTime()) {
    trueUp = await trueUpLateChange(tx, actorId, {
      id: version.id, ruleKey: input.key, effectiveFrom, label: def.title,
    }, now);
  }
  return { versionId: version.id, trueUp };
}

export async function saveRuleVersion(
  actorId: string,
  input: { key: string; value: unknown; effectiveFrom: Date; reason: string; origin?: "OWNER" | "PROFESSIONAL" },
): Promise<{ versionId: string; trueUp: TrueUpResult }> {
  return prisma.$transaction((tx) => saveRuleVersionInTx(tx, actorId, input));
}

/**
 * Undo an owner or professional change whose start date has not arrived yet.
 * The version stays as history, struck through on the screen; reads skip it.
 */
export async function undoRuleVersion(actorId: string, versionId: string, now: Date = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    await lockSettings(tx);
    const rows = await tx.$queryRaw<Array<{ id: string; ruleKey: string; origin: string; effectiveFrom: Date; undoneAt: Date | null }>>`
      SELECT "id", "ruleKey", "origin", "effectiveFrom", "undoneAt"
      FROM "LegalRuleVersion" WHERE "id" = ${versionId} FOR UPDATE
    `;
    const version = rows[0];
    if (!version) throw new Error("That rule change was not found.");
    if (version.undoneAt) throw new Error("That change was already undone.");
    if (version.origin !== "OWNER" && version.origin !== "PROFESSIONAL")
      throw new Error("Only a change set by the owner can be undone here.");
    if (version.effectiveFrom.getTime() <= now.getTime())
      throw new Error("That change has already started, so it cannot be undone. Change it instead.");
    await tx.legalRuleVersion.update({ where: { id: version.id }, data: { undoneAt: now } });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "rules.undo",
        entityType: "LegalRuleVersion",
        entityId: version.id,
        oldValue: { ruleKey: version.ruleKey, effectiveFrom: version.effectiveFrom.toISOString() },
        newValue: { undoneAt: now.toISOString() },
      },
    });
  });
}

export function validateTimingSettings(percent: number, marginBusinessDays: number): void {
  if (!Number.isInteger(percent) || percent < 85 || percent > 95)
    throw new Error("Timing percent must be a whole number from 85 through 95.");
  if (!Number.isInteger(marginBusinessDays) || marginBusinessDays < 1 || marginBusinessDays > 10)
    throw new Error("Safety margin must be a whole number from 1 through 10 business days.");
}

/** Owner timing settings for changes that cost the business (section 3). */
export async function saveRuleTimingSettings(
  actorId: string, input: { percent: number; marginBusinessDays: number; expectedPercent: number; expectedMarginBusinessDays: number },
): Promise<void> {
  validateTimingSettings(input.percent, input.marginBusinessDays);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const changed = await tx.businessSettings.updateMany({
      where: {
        id: "singleton",
        costlyChangeTimingPercent: input.expectedPercent,
        timingSafetyMarginBusinessDays: input.expectedMarginBusinessDays,
      },
      data: { costlyChangeTimingPercent: input.percent, timingSafetyMarginBusinessDays: input.marginBusinessDays },
    });
    if (changed.count !== 1) throw new Error("The timing settings were changed in another session. Refresh before saving.");
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "rules.timing.update",
        entityType: "BusinessSettings",
        entityId: "singleton",
        oldValue: { percent: input.expectedPercent, marginBusinessDays: input.expectedMarginBusinessDays },
        newValue: { percent: input.percent, marginBusinessDays: input.marginBusinessDays },
      },
    });
  });
}
