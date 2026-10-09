import type { Prisma } from "@prisma/client";
import type { AcquisitionTaxResult } from "./acquisition";

export type PendingPurchaseTaxExplanation = {
  reason: AcquisitionTaxResult["attentionReason"] | "ANSWER_LATER" | null;
  fixHref: string | null;
  fixLabel: string | null;
};

export async function explainPendingPurchaseTax(
  tx: Prisma.TransactionClient, applianceId: string,
): Promise<PendingPurchaseTaxExplanation> {
  const a = await tx.appliance.findUniqueOrThrow({
    where: { id: applianceId },
    select: { acquisitionTaxStatus: true, acquisitionTaxChoice: true,
      purchaseDate: true, acquisitionCostCents: true },
  });
  const href = "/desk/inventory/" + applianceId;
  if (a.acquisitionTaxStatus !== "UNKNOWN")
    return { reason: null, fixHref: null, fixLabel: null };
  if (!a.acquisitionTaxChoice || a.acquisitionTaxChoice === "LATER")
    return { reason: "ANSWER_LATER", fixHref: href, fixLabel: "Answer purchase tax" };
  if (!a.purchaseDate || a.acquisitionCostCents === null)
    return { reason: "PURCHASE_DATE_OR_COST_MISSING", fixHref: href,
      fixLabel: "Enter purchase date and cost" };
  const settings = await tx.businessSettings.findUnique({
    where: { id: "singleton" }, select: { shortTermLeaseElection: true },
  });
  if (!settings || settings.shortTermLeaseElection === "UNDECIDED")
    return { reason: "ELECTION_UNDECIDED", fixHref: "/desk/sales-tax/setup#decisions",
      fixLabel: "Choose tax treatment" };
  const location = await tx.addressTaxLocation.findFirst({
    where: { forBusinessLocation: true, isCurrent: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { jurisdictions: { include: { jurisdiction: { include: {
      rates: {
        where: { effectiveFrom: { lte: a.purchaseDate }, autoAppliedUndoneAt: null },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }], take: 1,
      },
    } } } } },
  });
  if (!location || location.status !== "VERIFIED" || !location.jurisdictions.length)
    return { reason: "BUSINESS_ADDRESS_UNVERIFIED",
      fixHref: "/desk/sales-tax/setup#business-tax-address", fixLabel: "Confirm business address" };
  if (location.jurisdictions.some(row =>
    row.jurisdiction.reviewStatus !== "REVIEWED" || row.jurisdiction.rates.length !== 1))
    return { reason: "RATES_UNREVIEWED", fixHref: "/desk/sales-tax/areas#rates",
      fixLabel: "Review area tax rates" };
  return { reason: null, fixHref: href, fixLabel: "Review purchase tax" };
}
