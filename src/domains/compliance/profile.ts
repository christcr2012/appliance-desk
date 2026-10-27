import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { encryptField, hasFieldCryptoKey } from "@/lib/field-crypto";
import type { ComplianceContext } from "./registry";
import type { ComplianceProfile } from "@prisma/client";

/**
 * CMP-1: the owner's business facts (Compliance › Business facts, OWNER
 * only). One row. The EIN is stored encrypted with only its last 4 in the
 * clear; it is never written to an audit log, and saving is refused when
 * no encryption key is configured (the field is disabled on screen with
 * the reason, and an owner checklist row asks for the key to be set).
 */

export const ENTITY_TYPES = ["SINGLE_MEMBER_LLC", "MULTI_MEMBER_LLC", "S_CORP"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface BusinessFactsInput {
  entityType: EntityType;
  /** undefined = leave the EIN as it is; null or "" = remove it; a string = set it. */
  ein?: string | null;
  sosReportMonth: number | null;
  truckGvwrLbs: number | null;
  employees: number;
  hasHomeOffice: boolean;
  /** CMP-3: the payer identity for information returns; undefined = leave as-is. */
  payer?: {
    businessLegalName: string | null;
    businessAddress: string | null;
    businessCity: string | null;
    businessState: string | null;
    businessZip: string | null;
    businessPhone: string | null;
  };
}

/** The stored profile, or the starting values when none was saved yet. */
export async function getComplianceProfile(): Promise<ComplianceProfile> {
  const row = await prisma.complianceProfile.findUnique({ where: { id: "singleton" } });
  if (row) return row;
  return {
    id: "singleton",
    entityType: "SINGLE_MEMBER_LLC",
    einLast4: null,
    einEncrypted: null,
    sosReportMonth: null,
    truckGvwrLbs: null,
    employees: 0,
    hasHomeOffice: false,
    businessLegalName: null,
    businessAddress: null,
    businessCity: null,
    businessState: null,
    businessZip: null,
    businessPhone: null,
    updatedAt: new Date(0),
  };
}

/** Facts the registry decides with, before the books facts are merged in. */
export function profileContext(
  profile: ComplianceProfile,
  books: { hasDepreciableAssets: boolean; hasAssetSales: boolean },
): ComplianceContext {
  return {
    entityType: profile.entityType,
    employees: profile.employees,
    truckGvwrLbs: profile.truckGvwrLbs,
    sosReportMonth: profile.sosReportMonth,
    hasHomeOffice: profile.hasHomeOffice,
    hasEin: Boolean(profile.einEncrypted),
    hasDepreciableAssets: books.hasDepreciableAssets,
    hasAssetSales: books.hasAssetSales,
  };
}

export interface MissingFact {
  key: string;
  label: string;
  why: string;
}

/** Facts whose absence blocks or weakens an obligation, for "Needs you". */
export function missingFacts(profile: ComplianceProfile): MissingFact[] {
  const missing: MissingFact[] = [];
  if (!profile.sosReportMonth) {
    missing.push({
      key: "sosReportMonth",
      label: "Your LLC's report month",
      why: "The yearly Secretary of State report can't be scheduled until its month is known. It's on the SOS summary page for your LLC.",
    });
  }
  if (!profile.einEncrypted) {
    missing.push({
      key: "ein",
      label: "Your business EIN (if you have one)",
      why: "Needed later for 1099 filing and any payroll. It's stored encrypted and only the last 4 digits are ever shown.",
    });
  }
  if (profile.truckGvwrLbs === null) {
    missing.push({
      key: "truckGvwrLbs",
      label: "Your truck's weight rating (GVWR)",
      why: "Decides whether you need a USDOT number and confirms the heavy vehicle tax doesn't apply. It's on the sticker inside the driver's door.",
    });
  }
  return missing;
}

const digitsOnly = (value: string) => value.replace(/\D/g, "");

export async function saveBusinessFacts(actorId: string, input: BusinessFactsInput): Promise<void> {
  if (!ENTITY_TYPES.includes(input.entityType)) {
    throw new Error("Choose the business type.");
  }
  if (
    input.sosReportMonth !== null &&
    (!Number.isInteger(input.sosReportMonth) || input.sosReportMonth < 1 || input.sosReportMonth > 12)
  ) {
    throw new Error("The report month must be a month from 1 to 12.");
  }
  if (
    input.truckGvwrLbs !== null &&
    (!Number.isSafeInteger(input.truckGvwrLbs) || input.truckGvwrLbs < 500 || input.truckGvwrLbs > 200000)
  ) {
    throw new Error("Enter the truck's weight rating in pounds.");
  }
  if (!Number.isSafeInteger(input.employees) || input.employees < 0 || input.employees > 10000) {
    throw new Error("Enter how many employees you have.");
  }

  let einPatch: { einEncrypted: string | null; einLast4: string | null } | undefined;
  if (input.ein !== undefined) {
    if (input.ein === null || input.ein.trim() === "") {
      einPatch = { einEncrypted: null, einLast4: null };
    } else {
      const digits = digitsOnly(input.ein);
      if (digits.length !== 9) {
        throw new Error("An EIN is 9 digits — check it and try again.");
      }
      if (!hasFieldCryptoKey()) {
        throw new Error(
          "The EIN can't be saved yet: ask your developer to set the compliance encryption key (owner checklist).",
        );
      }
      einPatch = { einEncrypted: encryptField(digits), einLast4: digits.slice(-4) };
    }
  }

  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    // Lock the profile row before reading the "before" snapshot: two
    // overlapping saves then serialize, and the audit's changed fields are
    // always computed against the latest committed facts — never a stale
    // snapshot that could let a change slip through with no audit record.
    // The upsert first guarantees the singleton row exists to lock.
    await tx.complianceProfile.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
    });
    await tx.$queryRaw`SELECT "id" FROM "ComplianceProfile" WHERE "id" = 'singleton' FOR UPDATE`;
    const before = await tx.complianceProfile.findUnique({ where: { id: "singleton" } });
    const data = {
      entityType: input.entityType,
      sosReportMonth: input.sosReportMonth,
      truckGvwrLbs: input.truckGvwrLbs,
      employees: input.employees,
      hasHomeOffice: input.hasHomeOffice,
      ...(einPatch ?? {}),
      ...(input.payer ?? {}),
    };
    await tx.complianceProfile.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });
    // The audit names the changed fields only — never the EIN itself.
    const changed = Object.keys(data).filter((field) => {
      const key = field as keyof typeof data;
      return !before || before[key as keyof ComplianceProfile] !== data[key];
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "compliance.facts",
        entityType: "ComplianceProfile",
        entityId: "singleton",
        newValue: { changedFields: changed, einChanged: einPatch !== undefined },
      },
    });
  });
}
