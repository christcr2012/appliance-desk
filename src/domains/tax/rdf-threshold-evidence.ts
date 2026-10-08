import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

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
      select: { rdfThresholdCents: true, rdfThresholdCrossedOn: true },
    });
    if (!settings) throw new Error("BusinessSettings must be initialized.");
    if (settings.rdfThresholdCrossedOn) return settings.rdfThresholdCrossedOn;
    if (input.previousYearRetailCents !== 0 ||
        input.currentYearRetailCents <= settings.rdfThresholdCents) return null;
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
          thresholdCents: settings.rdfThresholdCents,
        },
      },
    });
    return day;
  });
}
