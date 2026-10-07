import type {
  Prisma,
  TaxAddressStatus,
  TaxAdministration,
  TaxJurisdictionLevel,
  TaxRateSource,
} from "@prisma/client";

import { MAX_TAX_RATE_MILLI_PERCENT } from "@/domains/billing/tax";
import {
  getColoradoRateSource,
  type ColoradoRateSource,
  type GisJurisdiction,
  type GisLookup,
} from "@/domains/tax/colorado-gis";
import {
  businessDateKey,
  businessDateFromKey,
} from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

const LOOKUP_REUSE_MS = 30 * 24 * 60 * 60 * 1000;

type AddressInput = {
  line1: string;
  line2?: string | null;
  city: string;
  zip: string;
};

type Target =
  | {
      kind: "SERVICE";
      serviceAddressId: string;
      address: AddressInput;
    }
  | {
      kind: "BUSINESS";
      address: AddressInput;
    };

type LocationTx = Prisma.TransactionClient;

function sourceKind(source: ColoradoRateSource): TaxRateSource {
  return (
    source as ColoradoRateSource & {
      kind?: "COLORADO_GIS" | "MANUAL";
    }
  ).kind ?? "COLORADO_GIS";
}

function isFresh(lookedUpAt: Date, now: Date): boolean {
  return lookedUpAt.getTime() >= now.getTime() - LOOKUP_REUSE_MS;
}

function currentWhere(target: Target) {
  return target.kind === "SERVICE"
    ? { serviceAddressId: target.serviceAddressId, isCurrent: true }
    : { forBusinessLocation: true, isCurrent: true };
}

async function currentLocation(tx: LocationTx, target: Target) {
  return tx.addressTaxLocation.findFirst({
    where: currentWhere(target),
    include: {
      jurisdictions: {
        include: { jurisdiction: true },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

async function lockTarget(tx: LocationTx, target: Target): Promise<void> {
  if (target.kind === "SERVICE") {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "ServiceAddress"
      WHERE "id" = ${target.serviceAddressId}
      FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new Error("Couldn't find that service address.");
    }
    return;
  }

  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "BusinessSettings"
    WHERE "id" = 'singleton'
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new Error("Business settings are not initialized.");
  }
}

function effectiveFromFor(date: Date): Date {
  const resolved = businessDateFromKey(businessDateKey(date));
  if (!resolved) {
    throw new Error("Couldn't resolve the Colorado business date.");
  }
  return resolved;
}

function validRate(rate: number | null): rate is number {
  return (
    rate !== null &&
    Number.isSafeInteger(rate) &&
    rate >= 0 &&
    rate <= MAX_TAX_RATE_MILLI_PERCENT
  );
}

async function resolveJurisdiction(
  tx: LocationTx,
  gis: GisJurisdiction,
  now: Date,
): Promise<
  | { id: string; reviewStatus: "NEEDS_REVIEW" | "REVIEWED"; note?: string }
  | { id: null; note: string }
> {
  let jurisdiction = await tx.taxJurisdiction.findUnique({
    where: { code: gis.code },
  });

  if (!jurisdiction) {
    if (!gis.administration) {
      return {
        id: null,
        note: `${gis.name} needs its collection method reviewed before it can be added.`,
      };
    }

    jurisdiction = await tx.taxJurisdiction.create({
      data: {
        code: gis.code,
        name: gis.name,
        level: gis.level,
        administration: gis.administration,
        reviewStatus: "NEEDS_REVIEW",
      },
    });
  } else {
    const changed =
      jurisdiction.name !== gis.name ||
      jurisdiction.level !== gis.level ||
      (gis.administration !== null &&
        jurisdiction.administration !== gis.administration);

    if (changed) {
      jurisdiction = await tx.taxJurisdiction.update({
        where: { id: jurisdiction.id },
        data: {
          name: gis.name,
          level: gis.level,
          ...(gis.administration
            ? { administration: gis.administration }
            : {}),
          reviewStatus: "NEEDS_REVIEW",
          reviewedByUserId: null,
          reviewedAt: null,
        },
      });
    }
  }

  const currentRate = await tx.taxRateVersion.findFirst({
    where: {
      jurisdictionId: jurisdiction.id,
      effectiveFrom: { lte: now },
    },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
  });

  let note: string | undefined;
  if (!currentRate && gis.rateMilliPercent !== null) {
    if (validRate(gis.rateMilliPercent)) {
      const effectiveFrom = effectiveFromFor(now);
      await tx.taxRateVersion.upsert({
        where: {
          jurisdictionId_effectiveFrom: {
            jurisdictionId: jurisdiction.id,
            effectiveFrom,
          },
        },
        create: {
          jurisdictionId: jurisdiction.id,
          rateMilliPercent: gis.rateMilliPercent,
          effectiveFrom,
          source: "COLORADO_GIS",
          sourceNote: "Address lookup",
        },
        update: {},
      });

      jurisdiction = await tx.taxJurisdiction.update({
        where: { id: jurisdiction.id },
        data: {
          reviewStatus: "NEEDS_REVIEW",
          reviewedByUserId: null,
          reviewedAt: null,
        },
      });
      note = `${jurisdiction.name} has a newly discovered rate that needs review.`;
    } else {
      note = `${jurisdiction.name} returned an invalid rate and needs review.`;
    }
  }

  return {
    id: jurisdiction.id,
    reviewStatus: jurisdiction.reviewStatus,
    ...(note ? { note } : {}),
  };
}

async function replaceCurrentLocation(
  tx: LocationTx,
  target: Target,
  input: {
    status: TaxAddressStatus;
    source: TaxRateSource;
    normalizedAddress?: string | null;
    reviewNote?: string | null;
    lookedUpAt: Date;
    confirmedByUserId?: string | null;
    jurisdictionIds?: string[];
  },
) {
  await tx.addressTaxLocation.updateMany({
    where: currentWhere(target),
    data: { isCurrent: false },
  });

  return tx.addressTaxLocation.create({
    data: {
      serviceAddressId:
        target.kind === "SERVICE" ? target.serviceAddressId : null,
      forBusinessLocation: target.kind === "BUSINESS",
      status: input.status,
      source: input.source,
      normalizedAddress: input.normalizedAddress ?? null,
      reviewNote: input.reviewNote ?? null,
      lookedUpAt: input.lookedUpAt,
      confirmedByUserId: input.confirmedByUserId ?? null,
      isCurrent: true,
      jurisdictions: input.jurisdictionIds?.length
        ? {
            create: input.jurisdictionIds.map((jurisdictionId) => ({
              jurisdictionId,
            })),
          }
        : undefined,
    },
  });
}

async function applyLookup(
  target: Target,
  lookup: GisLookup,
  source: ColoradoRateSource,
  now: Date,
  force: boolean,
): Promise<{ status: TaxAddressStatus }> {
  return prisma.$transaction(async (tx) => {
    await lockTarget(tx, target);

    const existing = await currentLocation(tx, target);
    if (!force && existing && isFresh(existing.lookedUpAt, now)) {
      return { status: existing.status };
    }

    if (lookup.status !== "MATCHED") {
      const status: TaxAddressStatus =
        lookup.status === "NOT_FOUND" ? "FAILED" : "NEEDS_REVIEW";
      await replaceCurrentLocation(tx, target, {
        status,
        source: sourceKind(source),
        reviewNote: lookup.message,
        lookedUpAt: now,
      });
      return { status };
    }

    const ids: string[] = [];
    const notes: string[] = [];
    let allReviewed = true;

    for (const gis of lookup.jurisdictions) {
      const resolved = await resolveJurisdiction(tx, gis, now);
      if (!resolved.id) {
        allReviewed = false;
        notes.push(resolved.note);
        continue;
      }

      if (!ids.includes(resolved.id)) ids.push(resolved.id);
      if (resolved.reviewStatus !== "REVIEWED") allReviewed = false;
      if (resolved.note) notes.push(resolved.note);
    }

    if (ids.length === 0) {
      allReviewed = false;
      notes.push("No reviewed tax areas were attached to this address.");
    }

    const status: TaxAddressStatus = allReviewed
      ? "VERIFIED"
      : "NEEDS_REVIEW";
    if (!allReviewed && notes.length === 0) {
      notes.push("Review the tax areas for this address before billing.");
    }

    await replaceCurrentLocation(tx, target, {
      status,
      source: "COLORADO_GIS",
      normalizedAddress: lookup.normalizedAddress,
      reviewNote: notes.length > 0 ? [...new Set(notes)].join(" ") : null,
      lookedUpAt: now,
      jurisdictionIds: ids,
    });

    return { status };
  });
}

async function locateTarget(
  target: Target,
  opts: { force?: boolean } = {},
): Promise<{ status: TaxAddressStatus }> {
  const now = new Date();
  const force = opts.force ?? false;

  if (!force) {
    const existing = await prisma.addressTaxLocation.findFirst({
      where: currentWhere(target),
      select: { status: true, lookedUpAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (existing && isFresh(existing.lookedUpAt, now)) {
      return { status: existing.status };
    }
  }

  const source = getColoradoRateSource();
  let lookup: GisLookup;
  try {
    lookup = await source.lookup(target.address);
  } catch {
    lookup = {
      status: "UNAVAILABLE",
      message:
        "Colorado tax lookup was unavailable. Review this address manually.",
    };
  }

  return applyLookup(target, lookup, source, now, force);
}

export async function locateServiceAddress(
  serviceAddressId: string,
  opts: { force?: boolean } = {},
): Promise<{ status: TaxAddressStatus }> {
  const address = await prisma.serviceAddress.findUnique({
    where: { id: serviceAddressId },
    select: { id: true, line1: true, line2: true, city: true, zip: true },
  });
  if (!address) throw new Error("Couldn't find that service address.");

  return locateTarget(
    {
      kind: "SERVICE",
      serviceAddressId: address.id,
      address: {
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        zip: address.zip,
      },
    },
    opts,
  );
}

/**
 * Business-address counterpart required by WU-T3's business-location case.
 * The address itself remains an owner setting; this function only locates the
 * configured value and never invents missing fields.
 */
export async function locateBusinessTaxAddress(
  opts: { force?: boolean } = {},
): Promise<{ status: TaxAddressStatus }> {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { businessTaxAddress: true },
  });
  const raw = settings?.businessTaxAddress;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return writeMissingBusinessAddress();
  }

  const value = raw as Record<string, unknown>;
  const line1 = typeof value.line1 === "string" ? value.line1.trim() : "";
  const line2 =
    typeof value.line2 === "string" ? value.line2.trim() || null : null;
  const city = typeof value.city === "string" ? value.city.trim() : "";
  const zip = typeof value.zip === "string" ? value.zip.trim() : "";

  if (!line1 || !city || !zip) return writeMissingBusinessAddress();

  return locateTarget(
    {
      kind: "BUSINESS",
      address: { line1, line2, city, zip },
    },
    opts,
  );
}

async function writeMissingBusinessAddress(): Promise<{
  status: TaxAddressStatus;
}> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const target: Target = {
      kind: "BUSINESS",
      address: { line1: "", city: "", zip: "" },
    };
    await lockTarget(tx, target);
    const existing = await currentLocation(tx, target);
    if (existing && isFresh(existing.lookedUpAt, now)) {
      return { status: existing.status };
    }
    await replaceCurrentLocation(tx, target, {
      status: "NEEDS_REVIEW",
      source: "MANUAL",
      reviewNote:
        "Enter the business tax address before calculating purchase use tax.",
      lookedUpAt: now,
    });
    return { status: "NEEDS_REVIEW" };
  });
}

export async function confirmAddressLocation(
  actorUserId: string,
  input: { serviceAddressId: string; jurisdictionIds: string[] },
): Promise<void> {
  const jurisdictionIds = [...new Set(input.jurisdictionIds)];
  if (jurisdictionIds.length === 0) {
    throw new Error("Choose at least one tax area for this address.");
  }

  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);

    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "ServiceAddress"
      WHERE "id" = ${input.serviceAddressId}
      FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new Error("Couldn't find that service address.");
    }

    const jurisdictions = await tx.taxJurisdiction.findMany({
      where: { id: { in: jurisdictionIds } },
      select: { id: true },
    });
    if (jurisdictions.length !== jurisdictionIds.length) {
      throw new Error("One or more selected tax areas no longer exist.");
    }

    const target: Target = {
      kind: "SERVICE",
      serviceAddressId: input.serviceAddressId,
      address: { line1: "", city: "", zip: "" },
    };
    const previous = await currentLocation(tx, target);
    const previousIds =
      previous?.jurisdictions.map((row) => row.jurisdictionId) ?? [];

    await replaceCurrentLocation(tx, target, {
      status: "VERIFIED",
      source: "MANUAL",
      reviewNote: null,
      lookedUpAt: new Date(),
      confirmedByUserId: actorUserId,
      jurisdictionIds,
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "tax.address.confirm",
        entityType: "TaxPolicy",
        entityId: input.serviceAddressId,
        oldValue: { jurisdictionIds: previousIds },
        newValue: { jurisdictionIds },
      },
    });
  });
}

export async function importBulkLookupFile(
  actorUserId: string,
  csvText: string,
): Promise<{ matched: number; needsReview: number; errors: string[] }> {
  await prisma.$transaction((tx) =>
    assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]),
  );
  void csvText;

  // WU-T0 has not supplied the authenticated SUTS bulk-file column contract.
  // Reject instead of guessing a CSV layout.
  return {
    matched: 0,
    needsReview: 0,
    errors: [
      "Bulk Colorado tax lookup import is not configured yet. Review addresses manually until the SUTS file format is recorded.",
    ],
  };
}
