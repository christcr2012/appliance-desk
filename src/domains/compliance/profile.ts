import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey } from "@/lib/business-date";
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
  /** CMP-5: the hiring fact; undefined = leave as-is. The date travels as a YYYY-MM-DD key. */
  hiring?: {
    firstHireDate: string | null;
  };
  /** CMP-4: the local-filing facts; undefined = leave as-is. The license date travels as a YYYY-MM-DD key. */
  local?: {
    tradeName: string | null;
    usdotNumber: string | null;
    truckRegistrationMonth: number | null;
    greeleyLicenseDate: string | null;
    registeredAgentName: string | null;
    registeredAgentAddress: string | null;
    registeredAgentCity: string | null;
    registeredAgentState: string | null;
    registeredAgentZip: string | null;
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
    tradeName: null,
    usdotNumber: null,
    truckRegistrationMonth: null,
    greeleyLicenseDate: null,
    firstHireDate: null,
    registeredAgentName: null,
    registeredAgentAddress: null,
    registeredAgentCity: null,
    registeredAgentState: null,
    registeredAgentZip: null,
    businessBeganOn: null,
    homeOfficeSqFt: null,
    homeSqFt: null,
    homeHousingCostsCents: null,
    homeUtilitiesCents: null,
    homeInsuranceCents: null,
    homeOfficeAttestedYear: null,
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
    tradeName: profile.tradeName,
    usdotNumber: profile.usdotNumber,
    truckRegistrationMonth: profile.truckRegistrationMonth,
    greeleyLicenseDate: profile.greeleyLicenseDate,
    firstHireDate: profile.firstHireDate,
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
  if (profile.truckGvwrLbs !== null && profile.truckRegistrationMonth === null) {
    missing.push({
      key: "truckRegistrationMonth",
      label: "Your truck's registration month",
      why: "The registration and specific ownership tax renew in that month each year. It's the month on the truck's current registration card.",
    });
  }
  if (profile.truckGvwrLbs !== null && profile.truckGvwrLbs >= 16001 && !profile.usdotNumber) {
    missing.push({
      key: "usdotNumber",
      label: "Your USDOT number",
      why: "At 16,001 lb or more the truck needs one, and its last two digits set the every-two-years update schedule — the app reads the dates off the number itself.",
    });
  }
  if (profile.greeleyLicenseDate === null) {
    missing.push({
      key: "greeleyLicenseDate",
      label: "Your Greeley license date",
      why: "The city license renews every two years on the date it was issued. The date is on the license from the city's sales tax portal.",
    });
  }
  if (profile.employees > 0 && profile.firstHireDate === null) {
    missing.push({
      key: "firstHireDate",
      label: "Your first employee's start date",
      why: "The Colorado new-hire report is due 20 days after your first employee starts. Until the date is recorded, that deadline can't be scheduled.",
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
  let localPatch:
    | {
        tradeName: string | null;
        usdotNumber: string | null;
        truckRegistrationMonth: number | null;
        greeleyLicenseDate: Date | null;
        registeredAgentName: string | null;
        registeredAgentAddress: string | null;
        registeredAgentCity: string | null;
        registeredAgentState: string | null;
        registeredAgentZip: string | null;
      }
    | undefined;
  if (input.local !== undefined) {
    const local = input.local;
    if (
      local.truckRegistrationMonth !== null &&
      (!Number.isInteger(local.truckRegistrationMonth) || local.truckRegistrationMonth < 1 || local.truckRegistrationMonth > 12)
    ) {
      throw new Error("The registration month must be a month from 1 to 12.");
    }
    const usdotNumber = local.usdotNumber?.replace(/[\s-]/g, "") || null;
    if (usdotNumber !== null && !/^\d{2,10}$/.test(usdotNumber)) {
      throw new Error("A USDOT number is digits only (2 to 10) — check it and try again.");
    }
    let greeleyLicenseDate: Date | null = null;
    if (local.greeleyLicenseDate) {
      greeleyLicenseDate = businessDateFromKey(local.greeleyLicenseDate);
      if (!greeleyLicenseDate) {
        throw new Error("Enter the Greeley license date like 2026-05-01.");
      }
    }
    const trimmed = (value: string | null) => value?.trim() || null;
    localPatch = {
      tradeName: trimmed(local.tradeName),
      usdotNumber,
      truckRegistrationMonth: local.truckRegistrationMonth,
      greeleyLicenseDate,
      registeredAgentName: trimmed(local.registeredAgentName),
      registeredAgentAddress: trimmed(local.registeredAgentAddress),
      registeredAgentCity: trimmed(local.registeredAgentCity),
      registeredAgentState: trimmed(local.registeredAgentState),
      registeredAgentZip: trimmed(local.registeredAgentZip),
    };
  }

  let hiringPatch: { firstHireDate: Date | null } | undefined;
  if (input.hiring !== undefined) {
    let firstHireDate: Date | null = null;
    if (input.hiring.firstHireDate) {
      firstHireDate = businessDateFromKey(input.hiring.firstHireDate);
      if (!firstHireDate) {
        throw new Error("Enter the first employee's start date like 2026-05-01.");
      }
    }
    hiringPatch = { firstHireDate };
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
      ...(localPatch ?? {}),
      ...(hiringPatch ?? {}),
    };
    await tx.complianceProfile.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });
    // The audit names the changed fields only — never the EIN itself.
    // Dates compare by instant, not by object, so re-saving the same
    // license date does not report a change that never happened.
    const changed = Object.keys(data).filter((field) => {
      const key = field as keyof typeof data;
      if (!before) return true;
      const beforeValue = before[key as keyof ComplianceProfile];
      const afterValue = data[key];
      if (beforeValue instanceof Date && afterValue instanceof Date) {
        return beforeValue.getTime() !== afterValue.getTime();
      }
      return beforeValue !== afterValue;
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
