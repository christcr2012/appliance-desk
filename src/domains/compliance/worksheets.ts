import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { ruleAsOf } from "@/domains/rules/reads";
import { RESALE_STATUS_LABEL, type ResaleTaxStatus } from "@/domains/sales/retired-sale-tax";

/**
 * CMP-2 — the Form 4562 and Form 4797 worksheets.
 *
 * Both are estimates for the CPA, built only from records the business
 * already keeps — never from invented numbers:
 *
 * - 4562: appliances and equipment placed in service in the tax year,
 *   with the tax evidence recorded for each (Section 179, bonus and
 *   allowed depreciation). An asset without recorded evidence is listed
 *   as needing CPA review with no figures. The year's dated Section 179
 *   limit and bonus percentage from the rule book are shown alongside
 *   when the rule book has them.
 * - 4797: the year's retired-appliance sales, using the Section 1245
 *   estimate that was frozen onto each sale record when the sale
 *   happened (src/domains/sales) — the worksheet reports that estimate,
 *   it never recomputes a second one.
 */

export interface Worksheet4562Row {
  assetNumber: string;
  description: string;
  placedInServiceOn: string;
  costCents: number;
  lifeMonths: number;
  section179Cents: number | null;
  bonusCents: number | null;
  allowedDepreciationCents: number | null;
  confidence: string;
  needsReview: boolean;
}

export interface Worksheet4562 {
  year: number;
  rows: Worksheet4562Row[];
  totalCostCents: number;
  totalSection179Cents: number;
  totalBonusCents: number;
  placedInServiceCount: number;
  /** Assets placed in service in earlier years (still on the books at year end). */
  priorAssetsCount: number;
  priorAssetsCostCents: number;
  section179LimitCents: number | null;
  section179PhaseoutCents: number | null;
  bonusPercent: number | null;
  bonusAcquiredAfter: string | null;
}

export async function build4562Worksheet(year: number): Promise<Worksheet4562> {
  const start = businessDateFromKey(`${year}-01-01`)!;
  const end = businessDateFromKey(`${year + 1}-01-01`)!;
  const assets = await prisma.bookAsset.findMany({
    where: { placedInServiceOn: { gte: start, lt: end } },
    include: {
      appliance: { select: { assetNumber: true, manufacturer: true, model: true } },
      taxEvidence: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
    },
    orderBy: { placedInServiceOn: "asc" },
  });
  const rows: Worksheet4562Row[] = assets.map((asset) => {
    const evidence = asset.taxEvidence[0];
    const description = [asset.appliance.manufacturer, asset.appliance.model].filter(Boolean).join(" ") || "Appliance";
    return {
      assetNumber: asset.appliance.assetNumber,
      description,
      placedInServiceOn: businessDateKey(asset.placedInServiceOn),
      costCents: asset.costCents,
      lifeMonths: asset.lifeMonths,
      section179Cents: evidence?.section179Cents ?? null,
      bonusCents: evidence?.bonusDepreciationCents ?? null,
      allowedDepreciationCents: evidence?.allowedDepreciationCents ?? null,
      confidence: evidence?.confidence ?? "UNKNOWN",
      needsReview: !evidence || evidence.confidence === "UNKNOWN" || evidence.classification === "UNKNOWN",
    };
  });
  const prior = await prisma.bookAsset.findMany({
    where: { placedInServiceOn: { lt: start }, OR: [{ retiredOn: null }, { retiredOn: { gte: start } }] },
    select: { costCents: true },
  });
  let section179: { limitCents: number; phaseoutCents: number } | null = null;
  let bonus: { percent: number; acquiredAfter: string } | null = null;
  try {
    section179 = (await ruleAsOf<{ limitCents: number; phaseoutCents: number }>("us.section179", start)).value;
  } catch {
    section179 = null; // the rule book has no version for that year — the CPA confirms
  }
  try {
    bonus = (await ruleAsOf<{ percent: number; acquiredAfter: string }>("us.bonus_depreciation", start)).value;
  } catch {
    bonus = null;
  }
  return {
    year,
    rows,
    totalCostCents: rows.reduce((n, r) => n + r.costCents, 0),
    totalSection179Cents: rows.reduce((n, r) => n + (r.section179Cents ?? 0), 0),
    totalBonusCents: rows.reduce((n, r) => n + (r.bonusCents ?? 0), 0),
    placedInServiceCount: rows.length,
    priorAssetsCount: prior.length,
    priorAssetsCostCents: prior.reduce((n, a) => n + a.costCents, 0),
    section179LimitCents: section179?.limitCents ?? null,
    section179PhaseoutCents: section179?.phaseoutCents ?? null,
    bonusPercent: bonus?.percent ?? null,
    bonusAcquiredAfter: bonus?.acquiredAfter ?? null,
  };
}

export interface Worksheet4797Row {
  assetNumber: string;
  saleDate: string;
  priceCents: number;
  sellerCostsCents: number;
  adjustedBasisCents: number | null;
  totalDepreciationCents: number | null;
  taxGainCents: number | null;
  potentialRecaptureCents: number | null;
  otherGainCents: number | null;
  status: string;
  statusLabel: string;
  reviewReasons: string[];
}

export interface Worksheet4797 {
  year: number;
  rows: Worksheet4797Row[];
  totalPriceCents: number;
  totalGainCents: number;
  needsReviewCount: number;
}

export async function build4797Worksheet(year: number): Promise<Worksheet4797> {
  const start = businessDateFromKey(`${year}-01-01`)!;
  const end = businessDateFromKey(`${year + 1}-01-01`)!;
  const sales = await prisma.retiredSaleDisposition.findMany({
    where: { saleDate: { gte: start, lt: end }, cancelledAt: null },
    include: { appliance: { select: { assetNumber: true } } },
    orderBy: { saleDate: "asc" },
  });
  const rows: Worksheet4797Row[] = sales.map((sale) => ({
    assetNumber: sale.appliance.assetNumber,
    saleDate: businessDateKey(sale.saleDate),
    priceCents: sale.priceCents,
    sellerCostsCents: sale.sellerCostsCents,
    adjustedBasisCents: sale.adjustedBasisCents,
    totalDepreciationCents: sale.totalDepreciationCents,
    taxGainCents: sale.taxGainCents,
    potentialRecaptureCents: sale.potentialRecaptureCents,
    otherGainCents: sale.otherGainCents,
    status: sale.taxStatus,
    statusLabel: RESALE_STATUS_LABEL[sale.taxStatus as ResaleTaxStatus] ?? sale.taxStatus,
    reviewReasons: sale.reviewReasons,
  }));
  return {
    year,
    rows,
    totalPriceCents: rows.reduce((n, r) => n + r.priceCents, 0),
    totalGainCents: rows.reduce((n, r) => n + (r.taxGainCents ?? 0), 0),
    needsReviewCount: rows.filter((r) => r.status !== "CPA_CONFIRMED_ESTIMATE").length,
  };
}
