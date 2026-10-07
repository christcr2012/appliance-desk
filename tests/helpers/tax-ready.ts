import { createHash } from "node:crypto";

import { TAX_CHARGE_CATEGORIES } from "@/domains/tax/categories";
import { prisma } from "@/lib/prisma";

type SeedTaxReadyOptions = {
  rateMilliPercent?: number;
};

export async function seedTaxReadyContext(
  serviceAddressId: string,
  options: SeedTaxReadyOptions = {},
) {
  const suffix = createHash("sha256").update(serviceAddressId).digest("hex").slice(0, 16);
  const jurisdictionId = `test-tax-jurisdiction-${suffix}`;
  const rateVersionId = `test-tax-rate-${suffix}`;
  const rateMilliPercent = options.rateMilliPercent ?? 1000;
  const effectiveFrom = new Date("2020-01-01T07:00:00.000Z");

  const originalElection = (
    await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { shortTermLeaseElection: true },
    })
  ).shortTermLeaseElection;

  await prisma.taxJurisdiction.upsert({
    where: { id: jurisdictionId },
    update: {
      name: "Synthetic test jurisdiction",
      administration: "STATE_COLLECTED",
      reviewStatus: "REVIEWED",
    },
    create: {
      id: jurisdictionId,
      code: `TEST-${suffix}`,
      name: "Synthetic test jurisdiction",
      level: "CITY",
      administration: "STATE_COLLECTED",
      reviewStatus: "REVIEWED",
    },
  });

  await prisma.taxRateVersion.upsert({
    where: { id: rateVersionId },
    update: { rateMilliPercent, effectiveFrom, source: "MANUAL" },
    create: {
      id: rateVersionId,
      jurisdictionId,
      rateMilliPercent,
      effectiveFrom,
      source: "MANUAL",
    },
  });

  for (const category of TAX_CHARGE_CATEGORIES) {
    await prisma.taxabilityRule.upsert({
      where: { jurisdictionId_category: { jurisdictionId, category } },
      update: { taxability: "TAXABLE", reason: "Synthetic test fixture" },
      create: {
        jurisdictionId,
        category,
        taxability: "TAXABLE",
        reason: "Synthetic test fixture",
      },
    });
  }

  await prisma.addressTaxLocation.updateMany({
    where: { serviceAddressId, isCurrent: true },
    data: { isCurrent: false },
  });
  const location = await prisma.addressTaxLocation.create({
    data: {
      serviceAddressId,
      status: "VERIFIED",
      source: "MANUAL",
      lookedUpAt: new Date(),
      jurisdictions: { create: { jurisdictionId } },
    },
  });
  await prisma.businessSettings.update({
    where: { id: "singleton" },
    data: { shortTermLeaseElection: "COLLECT_ON_RENTALS" },
  });

  async function cleanup() {
    await prisma.addressTaxLocation.deleteMany({ where: { serviceAddressId } });
    await prisma.providerOperation.deleteMany({
      where: { kind: "TAX_RATE_CREATE", subjectId: rateVersionId },
    });
    await prisma.taxabilityRule.deleteMany({ where: { jurisdictionId } });
    await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { shortTermLeaseElection: originalElection },
    });
  }

  return { jurisdictionId, rateVersionId, locationId: location.id, cleanup };
}
