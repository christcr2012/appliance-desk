import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { ruleAsOf } from "@/domains/rules/reads";
import { findRdfThresholdCrossing, recordedRetailSales } from "./rdf-sales-evidence";

function verifyCents(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(field + " must be nonnegative whole cents.");
  }
}

/**
 * Record only the first evidenced threshold crossing for a new Colorado
 * retail business. Retry-safe and serialized against settings updates.
 * Call with invoice-derived taxable retail sales, excluding tax and RDF.
 * Do not invent the historical crossing date from a current balance.
 */
export async function recordFirstRetailDeliveryFeeThresholdCrossing(input: {
  previousYearRetailCents: number;
  currentYearRetailCents: number;
  crossedOn: Date;
}): Promise<Date | null> {
  verifyCents(input.previousYearRetailCents, "Previous year retail sales");
  verifyCents(input.currentYearRetailCents, "Current year retail sales");
  const dateKey = businessDateKey(input.crossedOn);
  const day = businessDateFromKey(dateKey);
  if (!day) throw new Error("Invalid crossing day.");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const settings = await tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { rdfThresholdCrossedOn: true },
    });
    if (!settings) throw new Error("BusinessSettings must be initialized.");
    if (settings.rdfThresholdCrossedOn) return settings.rdfThresholdCrossedOn;
    // TFA-1: the small-seller limit is a dated rule, not a setting.
    const thresholdCents = (await ruleAsOf<number>("co.rdf.qualified_threshold", day, tx)).value;
    if (input.previousYearRetailCents !== 0 ||
        input.currentYearRetailCents <= thresholdCents) return null;
    await tx.businessSettings.update({
      where: { id: "singleton" },
      data: { rdfThresholdCrossedOn: day },
    });
    await tx.auditLog.create({
      data: {
        action: "tax.rdf.threshold_crossed",
        entityType: "BusinessSettings",
        entityId: "singleton",
        newValue: {
          date: dateKey,
          currentYearRetailCents: input.currentYearRetailCents,
          thresholdCents,
        },
      },
    });
    return day;
  });
}

/**
 * Nightly (TFA-2): if this year's Colorado retail sales passed the small-seller
 * limit, record the crossing date from the crossing invoice itself. Only a
 * first-year business records a crossing here — with any prior-year sales the
 * January 1 test governs instead. Safe to run every night: once recorded, the
 * date never moves.
 */
export async function recordCrossingIfCrossed(now: Date): Promise<Date | null> {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { rdfThresholdCrossedOn: true },
  });
  if (!settings) throw new Error("BusinessSettings must be initialized.");
  if (settings.rdfThresholdCrossedOn) return settings.rdfThresholdCrossedOn;
  const year = Number(businessDateKey(now).slice(0, 4));
  const snapshot = await prisma.$transaction(async (tx) => {
    const previousYearRetailCents = await recordedRetailSales(tx, year - 1);
    if (previousYearRetailCents !== 0) return null;
    const thresholdCents = (await ruleAsOf<number>("co.rdf.qualified_threshold", now, tx)).value;
    const crossing = await findRdfThresholdCrossing(tx, year, thresholdCents);
    if (!crossing) return null;
    const currentYearRetailCents = await recordedRetailSales(tx, year);
    return { previousYearRetailCents, currentYearRetailCents, crossedOn: crossing.crossedOn };
  });
  if (!snapshot) return null;
  return recordFirstRetailDeliveryFeeThresholdCrossing(snapshot);
}
