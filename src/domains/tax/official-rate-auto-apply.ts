import type { Prisma, TaxJurisdictionLevel } from "@prisma/client";

import { MAX_TAX_RATE_MILLI_PERCENT } from "@/domains/billing/tax";
import {
  addBusinessDays,
  businessDateFromKey,
  businessDateKey,
} from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

import {
  getColoradoRateSource,
  type ColoradoEffectiveRateObservation,
} from "./colorado-gis";
import {
  hasTwoDayRateConfirmationInTx,
  pruneTaxRateObservationsInTx,
  recordTaxRateObservationInTx,
} from "./official-rate-metadata";
import {
  applyTaxRateChanges,
  supersedeSubscriptionTaxUpdatesForRateVersion,
} from "./rate-changes";

export type OfficialRateCandidate = {
  jurisdictionId: string;
  jurisdictionCode: string;
  jurisdictionLevel: TaxJurisdictionLevel;
  effectiveFrom: Date;
  rateMilliPercent: number;
};

export type OfficialRateDecision =
  | { status: "OBSERVED"; observationId: string; confirmed: false }
  | { status: "AUTO_APPLIED"; observationId: string; rateVersionId: string }
  | { status: "REVIEW_REQUIRED"; observationId: string; reasons: string[] }
  | { status: "IGNORED"; reason: string };

export type OfficialRateObservationRun = {
  status: "SUPPORTED" | "UNSUPPORTED" | "UNAVAILABLE";
  observations: number;
  autoApplied: number;
  reviewRequired: number;
  ignored: number;
};

export const OFFICIAL_RATE_REASON = {
  AUTO_APPLY_DISABLED: "AUTO_APPLY_DISABLED",
  DELTA_EXCEEDS_LIMIT: "DELTA_EXCEEDS_LIMIT",
  EFFECTIVE_DATE_CONFLICT: "EFFECTIVE_DATE_CONFLICT",
  EFFECTIVE_DATE_IN_PAST: "EFFECTIVE_DATE_IN_PAST",
  INVALID_RATE: "INVALID_RATE",
  JURISDICTION_IDENTITY_MISMATCH: "JURISDICTION_IDENTITY_MISMATCH",
  JURISDICTION_NOT_REVIEWED: "JURISDICTION_NOT_REVIEWED",
  NO_CURRENT_RATE: "NO_CURRENT_RATE",
  NO_RATE_CHANGE: "NO_RATE_CHANGE",
  RATE_ALREADY_EXISTS: "RATE_ALREADY_EXISTS",
} as const;

function validRate(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_TAX_RATE_MILLI_PERCENT
  );
}

function normalizedBusinessDate(date: Date): Date {
  const normalized = businessDateFromKey(businessDateKey(date));
  if (!normalized) throw new Error("Could not normalize the Colorado date.");
  return normalized;
}

function isPastBusinessDate(date: Date, now: Date): boolean {
  return businessDateKey(date) < businessDateKey(now);
}

function absoluteDelta(left: number, right: number): number {
  return Math.abs(left - right);
}

async function lockJurisdiction(
  tx: Prisma.TransactionClient,
  jurisdictionId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "TaxJurisdiction"
    WHERE "id" = ${jurisdictionId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new Error("Couldn't find that tax jurisdiction.");
  }
}

async function decisionContext(
  tx: Prisma.TransactionClient,
  input: {
    jurisdictionId: string;
    effectiveFrom: Date;
    rateMilliPercent: number;
  },
) {
  const sameDate = await tx.taxRateVersion.findFirst({
    where: {
      jurisdictionId: input.jurisdictionId,
      effectiveFrom: input.effectiveFrom,
    },
    select: {
      id: true,
      rateMilliPercent: true,
      autoApplied: true,
      autoAppliedUndoneAt: true,
    },
    orderBy: { id: "asc" },
  });

  const previous = await tx.taxRateVersion.findFirst({
    where: {
      jurisdictionId: input.jurisdictionId,
      effectiveFrom: { lt: input.effectiveFrom },
      autoAppliedUndoneAt: null,
    },
    select: { id: true, rateMilliPercent: true, effectiveFrom: true },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
  });

  return { sameDate, previous };
}

async function auditDecision(
  tx: Prisma.TransactionClient,
  input: {
    action:
      | "OFFICIAL_RATE_AUTO_APPLIED"
      | "OFFICIAL_RATE_AUTO_APPLY_REJECTED"
      | "OFFICIAL_RATE_MANUAL_APPLIED"
      | "OFFICIAL_RATE_AUTO_APPLY_UNDONE";
    actorUserId?: string | null;
    jurisdiction: {
      id: string;
      code: string;
      level: TaxJurisdictionLevel;
    };
    oldRateMilliPercent: number | null;
    newRateMilliPercent: number;
    effectiveFrom: Date;
    observationId?: string | null;
    rateVersionId?: string | null;
    reasons?: string[];
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.rateVersionId ? "TaxRateVersion" : "TaxRateObservation",
      entityId: input.rateVersionId ?? input.observationId ?? input.jurisdiction.id,
      newValue: {
        jurisdictionId: input.jurisdiction.id,
        jurisdictionCode: input.jurisdiction.code,
        jurisdictionLevel: input.jurisdiction.level,
        oldRateMilliPercent: input.oldRateMilliPercent,
        newRateMilliPercent: input.newRateMilliPercent,
        effectiveFrom: input.effectiveFrom.toISOString(),
        observationId: input.observationId ?? null,
        rateVersionId: input.rateVersionId ?? null,
        guardrailReasons: input.reasons ?? [],
        decisionAt: new Date().toISOString(),
      },
    },
  });
}

export async function processOfficialRateCandidate(
  candidate: OfficialRateCandidate,
  now = new Date(),
): Promise<OfficialRateDecision[]> {
  if (!validRate(candidate.rateMilliPercent)) {
    return [{ status: "IGNORED", reason: OFFICIAL_RATE_REASON.INVALID_RATE }];
  }

  const effectiveFrom = normalizedBusinessDate(candidate.effectiveFrom);
  if (isPastBusinessDate(effectiveFrom, now)) {
    return [
      { status: "IGNORED", reason: OFFICIAL_RATE_REASON.EFFECTIVE_DATE_IN_PAST },
    ];
  }

  const decision = await prisma.$transaction(async (tx) => {
    await lockJurisdiction(tx, candidate.jurisdictionId);
    const jurisdiction = await tx.taxJurisdiction.findUnique({
      where: { id: candidate.jurisdictionId },
      select: {
        id: true,
        code: true,
        level: true,
        reviewStatus: true,
      },
    });
    if (
      !jurisdiction ||
      jurisdiction.code !== candidate.jurisdictionCode ||
      jurisdiction.level !== candidate.jurisdictionLevel
    ) {
      return {
        kind: "IGNORED" as const,
        reason: OFFICIAL_RATE_REASON.JURISDICTION_IDENTITY_MISMATCH,
      };
    }

    const observation = await recordTaxRateObservationInTx(tx, {
      jurisdictionId: jurisdiction.id,
      asOf: effectiveFrom,
      rateMilliPercent: candidate.rateMilliPercent,
      observedAt: now,
    });
    const confirmed = await hasTwoDayRateConfirmationInTx(tx, {
      jurisdictionId: jurisdiction.id,
      asOf: effectiveFrom,
      rateMilliPercent: candidate.rateMilliPercent,
      now,
    });
    if (!confirmed) {
      return {
        kind: "OBSERVED" as const,
        observationId: observation.id,
      };
    }

    const { sameDate, previous } = await decisionContext(tx, {
      jurisdictionId: jurisdiction.id,
      effectiveFrom,
      rateMilliPercent: candidate.rateMilliPercent,
    });

    if (sameDate?.rateMilliPercent === candidate.rateMilliPercent) {
      return {
        kind: "IGNORED" as const,
        reason: OFFICIAL_RATE_REASON.RATE_ALREADY_EXISTS,
      };
    }
    if (previous?.rateMilliPercent === candidate.rateMilliPercent && !sameDate) {
      return {
        kind: "IGNORED" as const,
        reason: OFFICIAL_RATE_REASON.NO_RATE_CHANGE,
      };
    }

    const settings = await tx.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: {
        autoApplyOfficialRateChanges: true,
        autoRateChangeMaxMilliPercent: true,
      },
    });

    const reasons: string[] = [];
    if (jurisdiction.reviewStatus !== "REVIEWED") {
      reasons.push(OFFICIAL_RATE_REASON.JURISDICTION_NOT_REVIEWED);
    }
    if (!previous) {
      reasons.push(OFFICIAL_RATE_REASON.NO_CURRENT_RATE);
    }
    if (sameDate && sameDate.rateMilliPercent !== candidate.rateMilliPercent) {
      reasons.push(OFFICIAL_RATE_REASON.EFFECTIVE_DATE_CONFLICT);
    }
    if (
      previous &&
      absoluteDelta(previous.rateMilliPercent, candidate.rateMilliPercent) >
        settings.autoRateChangeMaxMilliPercent
    ) {
      reasons.push(OFFICIAL_RATE_REASON.DELTA_EXCEEDS_LIMIT);
    }
    if (!settings.autoApplyOfficialRateChanges) {
      reasons.push(OFFICIAL_RATE_REASON.AUTO_APPLY_DISABLED);
    }

    if (reasons.length > 0) {
      await auditDecision(tx, {
        action: "OFFICIAL_RATE_AUTO_APPLY_REJECTED",
        jurisdiction,
        oldRateMilliPercent: previous?.rateMilliPercent ?? null,
        newRateMilliPercent: candidate.rateMilliPercent,
        effectiveFrom,
        observationId: observation.id,
        reasons,
      });
      return {
        kind: "REVIEW_REQUIRED" as const,
        observationId: observation.id,
        reasons,
      };
    }

    const version = await tx.taxRateVersion.create({
      data: {
        jurisdictionId: jurisdiction.id,
        rateMilliPercent: candidate.rateMilliPercent,
        effectiveFrom,
        source: "COLORADO_GIS",
        sourceNote: "Confirmed official Colorado GIS rate observation",
        autoApplied: true,
      },
      select: { id: true },
    });

    await auditDecision(tx, {
      action: "OFFICIAL_RATE_AUTO_APPLIED",
      jurisdiction,
      oldRateMilliPercent: previous?.rateMilliPercent ?? null,
      newRateMilliPercent: candidate.rateMilliPercent,
      effectiveFrom,
      observationId: observation.id,
      rateVersionId: version.id,
    });

    return {
      kind: "AUTO_APPLIED" as const,
      observationId: observation.id,
      rateVersionId: version.id,
    };
  });

  if (decision.kind === "OBSERVED") {
    return [
      {
        status: "OBSERVED",
        observationId: decision.observationId,
        confirmed: false,
      },
    ];
  }
  if (decision.kind === "AUTO_APPLIED") {
    await applyTaxRateChanges(now, {
      includeRateVersionIds: [decision.rateVersionId],
    });
    return [
      {
        status: "AUTO_APPLIED",
        observationId: decision.observationId,
        rateVersionId: decision.rateVersionId,
      },
    ];
  }
  if (decision.kind === "REVIEW_REQUIRED") {
    return [
      {
        status: "REVIEW_REQUIRED",
        observationId: decision.observationId,
        reasons: decision.reasons,
      },
    ];
  }
  return [{ status: "IGNORED", reason: decision.reason }];
}

function lookAheadThrough(now: Date): Date {
  const todayKey = businessDateKey(now);
  const [yearText, monthText] = todayKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  let targetKey = todayKey;
  if (month === 6) targetKey = `${year}-07-01`;
  if (month === 12) targetKey = `${year + 1}-01-01`;
  return businessDateFromKey(targetKey) ?? normalizedBusinessDate(now);
}

export async function runOfficialRateObservation(
  now = new Date(),
): Promise<OfficialRateObservationRun> {
  const source = getColoradoRateSource();
  if (!source.lookupEffectiveRates) {
    return {
      status: "UNSUPPORTED",
      observations: 0,
      autoApplied: 0,
      reviewRequired: 0,
      ignored: 0,
    };
  }

  const asOf = normalizedBusinessDate(now);
  const lookup = await source.lookupEffectiveRates({
    asOf,
    lookAheadThrough: lookAheadThrough(now),
  });
  if (lookup.status !== "SUPPORTED") {
    return {
      status: lookup.status,
      observations: 0,
      autoApplied: 0,
      reviewRequired: 0,
      ignored: 0,
    };
  }

  let observations = 0;
  let autoApplied = 0;
  let reviewRequired = 0;
  let ignored = 0;

  for (const observation of lookup.observations) {
    const jurisdiction = await prisma.taxJurisdiction.findUnique({
      where: { code: observation.jurisdictionCode },
      select: { id: true, code: true, level: true },
    });
    if (!jurisdiction || jurisdiction.level !== observation.jurisdictionLevel) {
      ignored += 1;
      continue;
    }

    const decisions = await processOfficialRateCandidate(
      {
        jurisdictionId: jurisdiction.id,
        jurisdictionCode: observation.jurisdictionCode,
        jurisdictionLevel: observation.jurisdictionLevel,
        effectiveFrom: observation.effectiveFrom,
        rateMilliPercent: observation.rateMilliPercent,
      },
      now,
    );
    for (const decision of decisions) {
      if (decision.status === "OBSERVED") observations += 1;
      else if (decision.status === "AUTO_APPLIED") autoApplied += 1;
      else if (decision.status === "REVIEW_REQUIRED") reviewRequired += 1;
      else ignored += 1;
    }
  }

  await prisma.$transaction((tx) => pruneTaxRateObservationsInTx(tx, now));

  return {
    status: "SUPPORTED",
    observations,
    autoApplied,
    reviewRequired,
    ignored,
  };
}

export type OfficialRateAttention =
  | {
      kind: "SCHEDULED";
      rateVersionId: string;
      jurisdictionName: string;
      oldRateMilliPercent: number | null;
      newRateMilliPercent: number;
      effectiveFrom: Date;
      createdAt: Date;
      undoAllowed: boolean;
    }
  | {
      kind: "REVIEW_REQUIRED";
      observationId: string;
      jurisdictionName: string;
      oldRateMilliPercent: number | null;
      newRateMilliPercent: number;
      effectiveFrom: Date;
      reasons: string[];
      observedAt: Date;
    };

export async function listOfficialRateAttention(
  now = new Date(),
): Promise<OfficialRateAttention[]> {
  const today = normalizedBusinessDate(now);
  const [scheduled, observations, settings] = await Promise.all([
    prisma.taxRateVersion.findMany({
      where: {
        source: "COLORADO_GIS",
        autoApplied: true,
        autoAppliedUndoneAt: null,
        effectiveFrom: { gte: today },
      },
      include: {
        jurisdiction: { select: { id: true, name: true } },
      },
      orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
      take: 50,
    }),
    prisma.taxRateObservation.findMany({
      where: { asOf: { gte: today }, observedAt: { lte: now } },
      include: {
        jurisdiction: {
          select: {
            id: true,
            name: true,
            reviewStatus: true,
          },
        },
      },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      take: 200,
    }),
    prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: {
        autoApplyOfficialRateChanges: true,
        autoRateChangeMaxMilliPercent: true,
      },
    }),
  ]);

  const items: OfficialRateAttention[] = [];
  for (const version of scheduled) {
    const previous = await prisma.taxRateVersion.findFirst({
      where: {
        jurisdictionId: version.jurisdictionId,
        effectiveFrom: { lt: version.effectiveFrom },
        autoAppliedUndoneAt: null,
      },
      select: { rateMilliPercent: true },
      orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    });
    items.push({
      kind: "SCHEDULED",
      rateVersionId: version.id,
      jurisdictionName: version.jurisdiction.name,
      oldRateMilliPercent: previous?.rateMilliPercent ?? null,
      newRateMilliPercent: version.rateMilliPercent,
      effectiveFrom: version.effectiveFrom,
      createdAt: version.createdAt,
      undoAllowed: isOfficialRateUndoAllowed(version.effectiveFrom, now),
    });
  }

  const groups = new Map<
    string,
    {
      observations: typeof observations;
      latest: (typeof observations)[number];
    }
  >();
  for (const observation of observations) {
    const key = [
      observation.jurisdictionId,
      observation.asOf.toISOString(),
      observation.rateMilliPercent,
    ].join(":");
    const group = groups.get(key);
    if (group) {
      group.observations.push(observation);
    } else {
      groups.set(key, { observations: [observation], latest: observation });
    }
  }

  for (const group of groups.values()) {
    const proofDays = new Set(
      group.observations.map((row) => businessDateKey(row.observedAt)),
    );
    if (proofDays.size < 2) continue;

    const latest = group.latest;
    const existing = await prisma.taxRateVersion.findFirst({
      where: {
        jurisdictionId: latest.jurisdictionId,
        effectiveFrom: latest.asOf,
        rateMilliPercent: latest.rateMilliPercent,
        autoAppliedUndoneAt: null,
      },
      select: { id: true },
    });
    if (existing) continue;

    const [previous, sameDate] = await Promise.all([
      prisma.taxRateVersion.findFirst({
        where: {
          jurisdictionId: latest.jurisdictionId,
          effectiveFrom: { lt: latest.asOf },
          autoAppliedUndoneAt: null,
        },
        select: { rateMilliPercent: true },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
      }),
      prisma.taxRateVersion.findFirst({
        where: {
          jurisdictionId: latest.jurisdictionId,
          effectiveFrom: latest.asOf,
        },
        select: { rateMilliPercent: true },
      }),
    ]);

    const reasons: string[] = [];
    if (latest.jurisdiction.reviewStatus !== "REVIEWED") {
      reasons.push(OFFICIAL_RATE_REASON.JURISDICTION_NOT_REVIEWED);
    }
    if (!previous) reasons.push(OFFICIAL_RATE_REASON.NO_CURRENT_RATE);
    if (
      sameDate &&
      sameDate.rateMilliPercent !== latest.rateMilliPercent
    ) {
      reasons.push(OFFICIAL_RATE_REASON.EFFECTIVE_DATE_CONFLICT);
    }
    if (
      previous &&
      absoluteDelta(previous.rateMilliPercent, latest.rateMilliPercent) >
        settings.autoRateChangeMaxMilliPercent
    ) {
      reasons.push(OFFICIAL_RATE_REASON.DELTA_EXCEEDS_LIMIT);
    }
    if (!settings.autoApplyOfficialRateChanges) {
      reasons.push(OFFICIAL_RATE_REASON.AUTO_APPLY_DISABLED);
    }
    if (reasons.length === 0) continue;

    items.push({
      kind: "REVIEW_REQUIRED",
      observationId: latest.id,
      jurisdictionName: latest.jurisdiction.name,
      oldRateMilliPercent: previous?.rateMilliPercent ?? null,
      newRateMilliPercent: latest.rateMilliPercent,
      effectiveFrom: latest.asOf,
      reasons,
      observedAt: latest.observedAt,
    });
  }

  return items.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "REVIEW_REQUIRED" ? -1 : 1;
    const leftDate =
      left.kind === "REVIEW_REQUIRED" ? left.observedAt : left.createdAt;
    const rightDate =
      right.kind === "REVIEW_REQUIRED" ? right.observedAt : right.createdAt;
    return leftDate.getTime() - rightDate.getTime();
  });
}

export async function undoAutoAppliedRateVersion(input: {
  rateVersionId: string;
  actorUserId: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();

  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, input.actorUserId, ["OWNER"]);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "TaxRateVersion"
      WHERE "id" = ${input.rateVersionId}
      FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error("Couldn't find that tax rate.");

    const version = await tx.taxRateVersion.findUniqueOrThrow({
      where: { id: input.rateVersionId },
      include: {
        jurisdiction: {
          select: { id: true, code: true, level: true },
        },
      },
    });
    if (!version.autoApplied || version.autoAppliedUndoneAt) {
      throw new Error("Only an active automatically applied rate can be undone.");
    }

    const dayBefore = addBusinessDays(version.effectiveFrom, -1);
    if (businessDateKey(now) >= businessDateKey(dayBefore)) {
      throw new Error(
        "This rate can no longer be undone because its day-before update window has started.",
      );
    }

    await tx.taxRateVersion.update({
      where: { id: version.id },
      data: { autoAppliedUndoneAt: now },
    });
    const previous = await tx.taxRateVersion.findFirst({
      where: {
        jurisdictionId: version.jurisdictionId,
        effectiveFrom: { lt: version.effectiveFrom },
        autoAppliedUndoneAt: null,
      },
      select: { rateMilliPercent: true },
      orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    });
    await auditDecision(tx, {
      action: "OFFICIAL_RATE_AUTO_APPLY_UNDONE",
      actorUserId: input.actorUserId,
      jurisdiction: version.jurisdiction,
      oldRateMilliPercent: previous?.rateMilliPercent ?? null,
      newRateMilliPercent: version.rateMilliPercent,
      effectiveFrom: version.effectiveFrom,
      rateVersionId: version.id,
      reasons: ["OWNER_UNDO"],
    });
  });

  await supersedeSubscriptionTaxUpdatesForRateVersion(input.rateVersionId);
}

export async function manuallyApplyObservedRate(input: {
  observationId: string;
  actorUserId: string;
  now?: Date;
}): Promise<{ rateVersionId: string }> {
  const now = input.now ?? new Date();

  const result = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, input.actorUserId, ["OWNER"]);

    const observation = await tx.taxRateObservation.findUniqueOrThrow({
      where: { id: input.observationId },
      select: {
        id: true,
        jurisdictionId: true,
        asOf: true,
        rateMilliPercent: true,
      },
    });
    await lockJurisdiction(tx, observation.jurisdictionId);

    // Re-read money-critical jurisdiction policy after the row lock. Address
    // rechecks/owner edits can reset a jurisdiction to NEEDS_REVIEW, and a
    // stale pre-lock relation must never authorize a rate application.
    const jurisdiction = await tx.taxJurisdiction.findUniqueOrThrow({
      where: { id: observation.jurisdictionId },
      select: {
        id: true,
        code: true,
        level: true,
        reviewStatus: true,
      },
    });

    const effectiveFrom = normalizedBusinessDate(observation.asOf);
    if (isPastBusinessDate(effectiveFrom, now)) {
      throw new Error("An official rate cannot be applied in the past.");
    }
    if (!validRate(observation.rateMilliPercent)) {
      throw new Error("The observed rate is invalid.");
    }
    if (jurisdiction.reviewStatus !== "REVIEWED") {
      throw new Error("Review this jurisdiction before applying its official rate.");
    }

    const { sameDate, previous } = await decisionContext(tx, {
      jurisdictionId: observation.jurisdictionId,
      effectiveFrom,
      rateMilliPercent: observation.rateMilliPercent,
    });
    if (sameDate) {
      throw new Error("A tax rate version already exists for that effective date.");
    }
    if (previous?.rateMilliPercent === observation.rateMilliPercent) {
      throw new Error("That observed rate is already current.");
    }

    const settings = await tx.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: {
        autoApplyOfficialRateChanges: true,
        autoRateChangeMaxMilliPercent: true,
      },
    });
    const reasons: string[] = [];
    if (!settings.autoApplyOfficialRateChanges) {
      reasons.push(OFFICIAL_RATE_REASON.AUTO_APPLY_DISABLED);
    }
    if (
      previous &&
      absoluteDelta(previous.rateMilliPercent, observation.rateMilliPercent) >
        settings.autoRateChangeMaxMilliPercent
    ) {
      reasons.push(OFFICIAL_RATE_REASON.DELTA_EXCEEDS_LIMIT);
    }

    const version = await tx.taxRateVersion.create({
      data: {
        jurisdictionId: observation.jurisdictionId,
        rateMilliPercent: observation.rateMilliPercent,
        effectiveFrom,
        source: "COLORADO_GIS",
        sourceNote: "Owner approved official Colorado GIS rate observation",
        recordedByUserId: input.actorUserId,
        autoApplied: false,
      },
      select: { id: true },
    });
    await auditDecision(tx, {
      action: "OFFICIAL_RATE_MANUAL_APPLIED",
      actorUserId: input.actorUserId,
      jurisdiction,
      oldRateMilliPercent: previous?.rateMilliPercent ?? null,
      newRateMilliPercent: observation.rateMilliPercent,
      effectiveFrom,
      observationId: observation.id,
      rateVersionId: version.id,
      reasons,
    });

    return { rateVersionId: version.id };
  });

  await applyTaxRateChanges(now, {
    includeRateVersionIds: [result.rateVersionId],
  });
  return result;
}

export function isOfficialRateUndoAllowed(
  effectiveFrom: Date,
  now = new Date(),
): boolean {
  return (
    businessDateKey(now) <
    businessDateKey(addBusinessDays(effectiveFrom, -1))
  );
}

export function effectiveObservationLookAheadThrough(now = new Date()): Date {
  return lookAheadThrough(now);
}

export function observationFromProvider(
  observation: ColoradoEffectiveRateObservation,
): Pick<
  OfficialRateCandidate,
  "jurisdictionCode" | "jurisdictionLevel" | "effectiveFrom" | "rateMilliPercent"
> {
  return observation;
}
