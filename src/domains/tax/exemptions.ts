import type {
  Prisma,
  TaxExemptionReason,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

export type TaxExemptionInput = {
  reason: TaxExemptionReason;
  certificateNumber?: string | null;
  certificatePhotoId?: string | null;
  jurisdictionIds?: string[];
  validFrom: Date;
  expiresOn?: Date | null;
  notes?: string | null;
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeJurisdictionIds(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
}

function validateDates(validFrom: Date, expiresOn: Date | null): void {
  if (Number.isNaN(validFrom.getTime())) {
    throw new Error("Enter a valid exemption start date.");
  }
  if (expiresOn && Number.isNaN(expiresOn.getTime())) {
    throw new Error("Enter a valid exemption expiration date.");
  }
  if (expiresOn && expiresOn.getTime() < validFrom.getTime()) {
    throw new Error("The exemption expiration date cannot be before its start date.");
  }
}

async function assertJurisdictionsExist(
  tx: Prisma.TransactionClient,
  jurisdictionIds: string[],
): Promise<void> {
  if (jurisdictionIds.length === 0) return;
  const found = await tx.taxJurisdiction.findMany({
    where: { id: { in: jurisdictionIds } },
    select: { id: true },
  });
  if (found.length !== jurisdictionIds.length) {
    throw new Error("One or more selected tax jurisdictions no longer exist.");
  }
}

async function exemptionDataInTx(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  input: TaxExemptionInput,
) {
  const expiresOn = input.expiresOn ?? null;
  validateDates(input.validFrom, expiresOn);
  const jurisdictionIds = normalizeJurisdictionIds(input.jurisdictionIds);
  await assertJurisdictionsExist(tx, jurisdictionIds);

  return {
    reason: input.reason,
    certificateNumber: normalizeOptionalText(input.certificateNumber),
    certificatePhotoId: normalizeOptionalText(input.certificatePhotoId),
    jurisdictionIds,
    validFrom: input.validFrom,
    expiresOn,
    verifiedByUserId: actorUserId,
    notes: normalizeOptionalText(input.notes),
  } satisfies Prisma.CustomerTaxExemptionUncheckedCreateInput;
}

export async function listCustomerTaxExemptions(
  actorUserId: string,
  customerId: string,
) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { id: true },
    });
    return tx.customerTaxExemption.findMany({
      where: { customerId },
      orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
  });
}

export async function listCustomerTaxExemptionJurisdictions(
  actorUserId: string,
  customerId: string,
): Promise<Array<{ id: string; name: string; level: string }>> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const addresses = await tx.serviceAddress.findMany({
      where: { customerId },
      select: {
        taxLocations: {
          where: { isCurrent: true },
          select: {
            jurisdictions: {
              select: {
                jurisdiction: {
                  select: { id: true, name: true, level: true },
                },
              },
            },
          },
        },
      },
    });
    const unique = new Map<string, { id: string; name: string; level: string }>();
    for (const address of addresses) {
      for (const location of address.taxLocations) {
        for (const row of location.jurisdictions) {
          unique.set(row.jurisdiction.id, {
            id: row.jurisdiction.id,
            name: row.jurisdiction.name,
            level: row.jurisdiction.level,
          });
        }
      }
    }
    return [...unique.values()].sort(
      (left, right) =>
        left.level.localeCompare(right.level) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    );
  });
}

export async function createCustomerTaxExemption(
  actorUserId: string,
  customerId: string,
  input: TaxExemptionInput,
) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { id: true },
    });
    const data = await exemptionDataInTx(tx, actorUserId, input);
    const row = await tx.customerTaxExemption.create({
      data: { ...data, customerId },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "tax.exemption_created",
        entityType: "CustomerTaxExemption",
        entityId: row.id,
        newValue: {
          customerId,
          reason: row.reason,
          jurisdictionIds: row.jurisdictionIds,
          validFrom: row.validFrom.toISOString(),
          expiresOn: row.expiresOn?.toISOString() ?? null,
          certificateOnFile: Boolean(row.certificateNumber || row.certificatePhotoId),
        },
      },
    });
    return row;
  });
}

export async function updateCustomerTaxExemption(
  actorUserId: string,
  exemptionId: string,
  input: TaxExemptionInput,
) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const existing = await tx.customerTaxExemption.findUniqueOrThrow({
      where: { id: exemptionId },
    });
    if (existing.revokedAt) {
      throw new Error("A revoked tax exemption cannot be edited. Add a new exemption instead.");
    }
    const data = await exemptionDataInTx(tx, actorUserId, input);
    const row = await tx.customerTaxExemption.update({
      where: { id: exemptionId },
      data,
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "tax.exemption_updated",
        entityType: "CustomerTaxExemption",
        entityId: row.id,
        oldValue: {
          reason: existing.reason,
          jurisdictionIds: existing.jurisdictionIds,
          validFrom: existing.validFrom.toISOString(),
          expiresOn: existing.expiresOn?.toISOString() ?? null,
        },
        newValue: {
          reason: row.reason,
          jurisdictionIds: row.jurisdictionIds,
          validFrom: row.validFrom.toISOString(),
          expiresOn: row.expiresOn?.toISOString() ?? null,
        },
      },
    });
    return row;
  });
}

export async function revokeCustomerTaxExemption(
  actorUserId: string,
  exemptionId: string,
  revokedAt = new Date(),
) {
  if (Number.isNaN(revokedAt.getTime())) {
    throw new Error("Enter a valid exemption revocation date.");
  }
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const existing = await tx.customerTaxExemption.findUniqueOrThrow({
      where: { id: exemptionId },
    });
    if (existing.revokedAt) return existing;
    const row = await tx.customerTaxExemption.update({
      where: { id: exemptionId },
      data: { revokedAt },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "tax.exemption_revoked",
        entityType: "CustomerTaxExemption",
        entityId: row.id,
        newValue: {
          customerId: row.customerId,
          revokedAt: row.revokedAt?.toISOString() ?? null,
        },
      },
    });
    return row;
  });
}
