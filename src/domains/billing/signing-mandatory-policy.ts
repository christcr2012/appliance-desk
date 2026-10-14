import { businessDateKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import type { Prisma } from "@prisma/client";

export type ChargeApplicability = "UNDECIDED" | "REQUIRED" | "NOT_APPLICABLE";
export type RetailDeliveryApplicability = "UNDECIDED" | "REQUIRED" | "EXEMPT";
export type MandatoryChargeDecision = {
  delivery: ChargeApplicability;
  installation: ChargeApplicability;
  removal: ChargeApplicability;
  damageWaiver: ChargeApplicability;
  retailDelivery: RetailDeliveryApplicability;
};
export type MandatorySigningPolicyVersion = {
  revision: number;
  effectiveFromKey: string;
  recordedAt: string;
  recordedByUserId: string;
  reason: string;
  decisions: MandatoryChargeDecision;
};
const CHARGE_FIELDS = ["delivery", "installation", "removal", "damageWaiver"] as const;
export const UNDECIDED_MANDATORY_SIGNING_POLICY: MandatoryChargeDecision = {
  delivery: "UNDECIDED", installation: "UNDECIDED", removal: "UNDECIDED",
  damageWaiver: "UNDECIDED", retailDelivery: "UNDECIDED",
};
function validDateKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const day = new Date(key + "T12:00:00Z");
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === key;
}
export function validateMandatorySigningPolicy(input: {
  effectiveFromKey: string; reason: string; decisions: MandatoryChargeDecision;
}) {
  if (!validDateKey(input.effectiveFromKey))
    throw new Error("Choose a real effective date in YYYY-MM-DD format.");
  if (!input.reason || input.reason.trim().length < 10 || input.reason.length > 500)
    throw new Error("Record a reason between 10 and 500 characters for this mandatory-charge policy.");
  for (const field of CHARGE_FIELDS) {
    if (!["UNDECIDED", "REQUIRED", "NOT_APPLICABLE"].includes(input.decisions[field]))
      throw new Error("Unknown applicability for " + field + ".");
  }
  if (!["UNDECIDED", "REQUIRED", "EXEMPT"].includes(input.decisions.retailDelivery))
    throw new Error("Choose a valid retail delivery fee applicability decision.");
  return { ...input, reason: input.reason.trim() };
}
export function parseMandatorySigningPolicyVersions(value: unknown): MandatorySigningPolicyVersion[] {
  if (!Array.isArray(value) || value.length > 256) return [];
  const versions: MandatorySigningPolicyVersion[] = [];
  let previous = 0;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const v = item as Record<string, unknown>;
    if (!Number.isSafeInteger(v.revision) || (v.revision as number) !== previous + 1
      || typeof v.recordedByUserId !== "string" || !v.recordedByUserId
      || typeof v.recordedAt !== "string" || !Number.isFinite(Date.parse(v.recordedAt))
      || typeof v.reason !== "string" || typeof v.effectiveFromKey !== "string"
      || !v.decisions || typeof v.decisions !== "object" || Array.isArray(v.decisions))
      return [];
    try {
      validateMandatorySigningPolicy({
        effectiveFromKey: v.effectiveFromKey,
        reason: v.reason,
        decisions: v.decisions as MandatoryChargeDecision,
      });
    } catch { return []; }
    previous++;
    versions.push(v as MandatorySigningPolicyVersion);
  }
  return versions;
}
export function effectiveMandatorySigningPolicy(
  value: unknown, at = new Date(),
): { decision: MandatoryChargeDecision; revision: number | null; reason: string | null } {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
    return { decision: UNDECIDED_MANDATORY_SIGNING_POLICY, revision: null, reason: null };
  const key = businessDateKey(at);
  const eligible = parseMandatorySigningPolicyVersions(value)
    .filter(v => v.effectiveFromKey <= key && new Date(v.recordedAt) <= at)
    .sort((a, b) => b.effectiveFromKey.localeCompare(a.effectiveFromKey) || b.revision - a.revision);
  const current = eligible[0];
  return current
    ? { decision: current.decisions, revision: current.revision, reason: current.reason }
    : { decision: UNDECIDED_MANDATORY_SIGNING_POLICY, revision: null, reason: null };
}

/**
 * Append-only owner-authorized policy in the existing BusinessSettings
 * singleton; each revision is audited and earlier revisions remain readable.
 * No saved policy qualifies as professional CPA/counsel approval, and none
 * authorizes a price-bearing send, signature, Stripe collection, or refund.
 */
export async function recordMandatorySigningPolicy(
  actorId: string,
  input: { effectiveFromKey: string; reason: string; decisions: MandatoryChargeDecision },
): Promise<MandatorySigningPolicyVersion> {
  const approved = validateMandatorySigningPolicy(input);
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    await tx.businessSettings.upsert({
      where: { id: "singleton" }, update: {}, create: { id: "singleton" },
    });
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const current = await tx.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { signingMandatoryPolicyVersions: true },
    });
    const old = parseMandatorySigningPolicyVersions(current.signingMandatoryPolicyVersions);
    if (Array.isArray(current.signingMandatoryPolicyVersions) &&
      current.signingMandatoryPolicyVersions.length && !old.length)
      throw new Error("Mandatory policy history failed integrity checks. Owner review is required.");
    if (old.length >= 256)
      throw new Error("Mandatory policy revision limit reached; preserve and review the history before updating.");
    const next: MandatorySigningPolicyVersion = {
      revision: old.length + 1,
      effectiveFromKey: approved.effectiveFromKey,
      recordedAt: new Date().toISOString(),
      recordedByUserId: actorId,
      reason: approved.reason,
      decisions: approved.decisions,
    };
    const versions = [...old, next] as unknown as Prisma.InputJsonValue;
    await tx.businessSettings.update({
      where: { id: "singleton" },
      data: { signingMandatoryPolicyVersions: versions },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId, action: "signing.mandatory_policy_version",
        entityType: "BusinessSettings", entityId: "singleton",
        oldValue: { previousRevision: old.at(-1)?.revision ?? null },
        newValue: JSON.parse(JSON.stringify(next)),
      },
    });
    return next;
  });
}
export async function getMandatorySigningPolicy(at = new Date()) {
  const row = await prisma.businessSettings.findUnique({
    where: { id: "singleton" }, select: { signingMandatoryPolicyVersions: true },
  });
  return effectiveMandatorySigningPolicy(row?.signingMandatoryPolicyVersions, at);
}
