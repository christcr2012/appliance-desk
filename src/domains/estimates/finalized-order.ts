import { prisma } from "@/lib/prisma";
import { getReviewedSigningOrderReadbackInTx, type ReviewedSigningOrderReadback } from "@/domains/billing/signing-order-readback";
import type { Prisma } from "@prisma/client";

export type FinalizedEstimateOrder =
  | { status: "FINAL_REVIEWED"; order: ReviewedSigningOrderReadback }
  | { status: "REVIEW_REQUIRED"; order: null };

/** No partial order, different-customer sibling, or unconverted prospect may receive final prices. */
export function completeConvertedEstimateScope(
  rows: readonly { id: string; customerId: string; sourceEstimateId: string | null }[],
  convertedAgreementCount: number,
  estimateId: string,
  customerId: string,
): string[] | null {
  if (!customerId || !estimateId || !Number.isSafeInteger(convertedAgreementCount) ||
      convertedAgreementCount < 1 || convertedAgreementCount > 500 ||
      rows.length !== convertedAgreementCount ||
      new Set(rows.map(row => row.id)).size !== rows.length ||
      rows.some(row => row.customerId !== customerId || row.sourceEstimateId !== estimateId)) {
    return null;
  }
  return rows.map(row => row.id).sort();
}

/**
 * Read-only public estimate readback after APPROVED → CONVERTED.
 * A finalized price is taken only from the full independently verified
 * frozen agreement set, never the estimate's obsolete monthly-only lines.
 * This never sends, signs, publishes, collects or creates agreements.
 */
export async function getFinalizedConvertedEstimateOrder(estimateId: string): Promise<FinalizedEstimateOrder> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const estimate = await tx.estimate.findUnique({
      where: { id: estimateId },
      select: { status: true, customerId: true },
    });
    if (!estimate || estimate.status !== "CONVERTED" || !estimate.customerId)
      return { status:"REVIEW_REQUIRED",order:null };
    const [allCount, agreements] = await Promise.all([
      tx.rentalAgreement.count({where:{sourceEstimateId:estimateId}}),
      tx.rentalAgreement.findMany({where:{
        sourceEstimateId:estimateId,customerId:estimate.customerId,
      },select:{id:true,customerId:true,sourceEstimateId:true},orderBy:{id:"asc"}}),
    ]);
    const scope=completeConvertedEstimateScope(agreements,allCount,estimateId,estimate.customerId);
    if (!scope) return {status:"REVIEW_REQUIRED",order:null};
    try {
      const order=await getReviewedSigningOrderReadbackInTx(tx,scope[0]);
      if (order.locations.length !== scope.length ||
          order.locations.some(line=>!scope.includes(line.agreementId))) {
        return {status:"REVIEW_REQUIRED",order:null};
      }
      return {status:"FINAL_REVIEWED",order};
    } catch {
      // Never expose half-frozen or mismatched agreement amounts on a bearer link.
      return {status:"REVIEW_REQUIRED",order:null};
    }
  });
}
