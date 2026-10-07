import { randomUUID } from "node:crypto";
import type {
  Prisma,
  TaxAddressStatus,
  TaxRateSource,
} from "@prisma/client";

import { MAX_TAX_RATE_MILLI_PERCENT } from "@/domains/billing/tax";
import type { TaxChargeCategory } from "@/domains/tax/categories";
import { resolveTaxability, type EngineInput, type EngineJurisdiction } from "@/domains/tax/engine";
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

function sameAddress(
  left: AddressInput,
  right: AddressInput,
): boolean {
  return (
    left.line1 === right.line1 &&
    (left.line2 ?? null) === (right.line2 ?? null) &&
    left.city === right.city &&
    left.zip === right.zip
  );
}

function addressFromJson(raw: unknown): AddressInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const line1 = typeof value.line1 === "string" ? value.line1.trim() : "";
  const line2 =
    typeof value.line2 === "string" ? value.line2.trim() || null : null;
  const city = typeof value.city === "string" ? value.city.trim() : "";
  const zip = typeof value.zip === "string" ? value.zip.trim() : "";
  return line1 && city && zip ? { line1, line2, city, zip } : null;
}

async function targetStillMatches(
  tx: LocationTx,
  target: Target,
): Promise<boolean> {
  if (target.kind === "SERVICE") {
    const current = await tx.serviceAddress.findUnique({
      where: { id: target.serviceAddressId },
      select: {
        line1: true,
        line2: true,
        city: true,
        zip: true,
        customer: { select: { archivedAt: true } },
      },
    });
    return Boolean(
      current &&
        !current.customer.archivedAt &&
        sameAddress(
          {
            line1: current.line1,
            line2: current.line2,
            city: current.city,
            zip: current.zip,
          },
          target.address,
        ),
    );
  }

  const settings = await tx.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { businessTaxAddress: true },
  });
  const current = addressFromJson(settings?.businessTaxAddress);
  return current ? sameAddress(current, target.address) : false;
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

    // Multiple address lookups can discover the same jurisdiction at once.
    // PostgreSQL's conflict handling makes that shared write race-safe inside
    // the surrounding transaction; a caught unique violation would poison it.
    await tx.$executeRaw`
      INSERT INTO "TaxJurisdiction"
        ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
      VALUES
        (
          ${randomUUID()},
          ${gis.code},
          ${gis.name},
          ${gis.level}::"TaxJurisdictionLevel",
          ${gis.administration}::"TaxAdministration",
          'NEEDS_REVIEW'::"TaxReviewStatus",
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      ON CONFLICT ("code") DO NOTHING
    `;
    jurisdiction = await tx.taxJurisdiction.findUniqueOrThrow({
      where: { code: gis.code },
    });
  }

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
      await tx.$executeRaw`
        INSERT INTO "TaxRateVersion"
          ("id", "jurisdictionId", "rateMilliPercent", "effectiveFrom", "source", "sourceNote", "createdAt")
        VALUES
          (
            ${randomUUID()},
            ${jurisdiction.id},
            ${gis.rateMilliPercent},
            ${effectiveFrom},
            'COLORADO_GIS'::"TaxRateSource",
            'Address lookup',
            CURRENT_TIMESTAMP
          )
        ON CONFLICT ("jurisdictionId", "effectiveFrom") DO NOTHING
      `;

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

    // The provider call happens outside the transaction. Re-read the address
    // after taking the row lock so a stale response cannot restore PII after
    // privacy deletion or overwrite a newer address edit.
    if (!(await targetStillMatches(tx, target))) {
      return { status: "NEEDS_REVIEW" };
    }

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
      if (resolved.id === null) {
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
  const address = addressFromJson(settings?.businessTaxAddress);
  if (!address) return writeMissingBusinessAddress();

  return locateTarget(
    {
      kind: "BUSINESS",
      address,
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

export class TaxNotReadyError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems.join(" "));
    this.name = "TaxNotReadyError";
    this.problems = problems;
  }
}

function chargeCategoriesForAgreement(agreement: {
  damageWaiverCents: number;
  lateFeeCents: number;
  lateFeePercent: number;
}): TaxChargeCategory[] {
  const categories: TaxChargeCategory[] = ["RENTAL"];
  if (agreement.damageWaiverCents > 0) categories.push("DAMAGE_WAIVER");
  if (agreement.lateFeeCents > 0 || agreement.lateFeePercent > 0) {
    categories.push("LATE_PAYMENT_FEE");
  }
  return categories;
}

export async function getAgreementTaxContext(
  tx: Prisma.TransactionClient,
  agreementId: string,
  taxDate: Date,
): Promise<Omit<EngineInput, "lines">> {
  const agreement = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: { termMonths: true, customerId: true, serviceAddressId: true },
  });
  const settings = await tx.businessSettings.findUniqueOrThrow({
    where: { id: "singleton" },
    select: { shortTermLeaseElection: true },
  });
  const defaultRows = await tx.taxabilityRule.findMany({
    where: { jurisdictionId: null },
    select: { category: true, taxability: true },
  });
  const defaultRules = Object.fromEntries(
    defaultRows.map((row) => [row.category, row.taxability]),
  ) as EngineInput["defaultRules"];
  const location = await tx.addressTaxLocation.findFirst({
    where: { serviceAddressId: agreement.serviceAddressId, isCurrent: true },
    include: {
      jurisdictions: {
        include: {
          jurisdiction: {
            include: {
              rules: { select: { category: true, taxability: true } },
              rates: {
                where: { effectiveFrom: { lte: taxDate } },
                orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
                take: 1,
              },
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const jurisdictions: EngineJurisdiction[] =
    location?.jurisdictions.map(({ jurisdiction }) => ({
      id: jurisdiction.id,
      code: jurisdiction.code,
      name: jurisdiction.name,
      administration: jurisdiction.administration,
      rate: jurisdiction.rates[0]
        ? {
            versionId: jurisdiction.rates[0].id,
            rateMilliPercent: jurisdiction.rates[0].rateMilliPercent,
          }
        : null,
      rules: Object.fromEntries(
        jurisdiction.rules.map((row) => [row.category, row.taxability]),
      ) as EngineJurisdiction["rules"],
    })) ?? [];
  return {
    taxDate,
    leaseTermMonths: agreement.termMonths,
    election: settings.shortTermLeaseElection,
    defaultRules,
    jurisdictions,
    exemptJurisdictionIds: new Set<string>(),
  };
}

export async function taxRateVersionIdsForAgreement(
  tx: Prisma.TransactionClient,
  agreementId: string,
  taxDate: Date,
  category: TaxChargeCategory,
): Promise<string[]> {
  const context = await getAgreementTaxContext(tx, agreementId, taxDate);
  const problems: string[] = [];
  const rateVersionIds: string[] = [];

  for (const jurisdiction of context.jurisdictions) {
    const resolution = resolveTaxability(jurisdiction, category, context);
    if (resolution.taxability === "UNDECIDED") {
      problems.push(
        `${category.replaceAll("_", " ").toLowerCase()} in ${jurisdiction.name}: decide whether it is taxable before billing.`,
      );
      continue;
    }
    if (resolution.taxability !== "TAXABLE" || context.exemptJurisdictionIds.has(jurisdiction.id)) {
      continue;
    }
    if (!jurisdiction.rate) {
      problems.push(
        `Enter a tax rate for ${jurisdiction.name} effective on ${businessDateKey(taxDate)}.`,
      );
      continue;
    }
    rateVersionIds.push(jurisdiction.rate.versionId);
  }

  const uniqueRateVersionIds = [...new Set(rateVersionIds)];
  if (uniqueRateVersionIds.length > 5) {
    problems.push(
      `${category.replaceAll("_", " ").toLowerCase()} resolves to ${uniqueRateVersionIds.length} taxable jurisdictions; Stripe supports at most 5 tax rates on one line. Review this address before billing.`,
    );
  }
  if (problems.length > 0) throw new TaxNotReadyError([...new Set(problems)]);
  return uniqueRateVersionIds;
}

export async function assertTaxReadyForAgreement(
  tx: Prisma.TransactionClient,
  agreementId: string,
): Promise<void> {
  const taxDate = new Date();
  const agreement = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: {
      serviceAddressId: true,
      damageWaiverCents: true,
      lateFeeCents: true,
      lateFeePercent: true,
    },
  });
  const settings = await tx.businessSettings.findUniqueOrThrow({
    where: { id: "singleton" },
    select: { shortTermLeaseElection: true },
  });
  const location = await tx.addressTaxLocation.findFirst({
    where: { serviceAddressId: agreement.serviceAddressId, isCurrent: true },
    include: {
      jurisdictions: {
        include: {
          jurisdiction: {
            include: {
              rates: {
                where: { effectiveFrom: { lte: taxDate } },
                orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
                take: 1,
              },
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const problems: string[] = [];
  if (settings.shortTermLeaseElection === "UNDECIDED") {
    problems.push("Choose the short-term rental tax treatment before billing.");
  }
  if (!location || location.status !== "VERIFIED") {
    problems.push("Confirm the tax areas for this service address before billing.");
  }
  if (location) {
    for (const row of location.jurisdictions) {
      if (row.jurisdiction.reviewStatus !== "REVIEWED") {
        problems.push(`Review ${row.jurisdiction.name} before billing.`);
      }
      if (!row.jurisdiction.rates[0]) {
        problems.push(`Enter a tax rate for ${row.jurisdiction.name} effective on ${businessDateKey(taxDate)}.`);
      }
    }
  }
  if (location?.status === "VERIFIED" && location.jurisdictions.length > 0) {
    const context = await getAgreementTaxContext(tx, agreementId, taxDate);
    for (const category of chargeCategoriesForAgreement(agreement)) {
      let taxableJurisdictions = 0;
      for (const jurisdiction of context.jurisdictions) {
        const resolution = resolveTaxability(jurisdiction, category, context);
        if (resolution.taxability === "UNDECIDED") {
          problems.push(`${category.replaceAll("_", " ").toLowerCase()} in ${jurisdiction.name}: decide whether it is taxable before billing.`);
        } else if (
          resolution.taxability === "TAXABLE" &&
          jurisdiction.rate &&
          !context.exemptJurisdictionIds.has(jurisdiction.id)
        ) {
          taxableJurisdictions += 1;
        }
      }
      if (taxableJurisdictions > 5) {
        problems.push(
          `${category.replaceAll("_", " ").toLowerCase()} resolves to ${taxableJurisdictions} taxable jurisdictions; Stripe supports at most 5 tax rates on one line. Review this address before billing.`,
        );
      }
    }
  }
  const uniqueProblems = [...new Set(problems)];
  if (uniqueProblems.length > 0) throw new TaxNotReadyError(uniqueProblems);
}
