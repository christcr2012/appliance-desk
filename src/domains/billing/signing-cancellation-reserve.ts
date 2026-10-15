import type { Prisma } from "@prisma/client";
import { signedReserveAmount } from "./signing-reserve-liability";

/** The signing receipt includes the reserve. Recognize that same liability once,
 * but never allow another deposit/refund to be folded into cancellation money. */
export async function getCancellationReserveInTx(tx: Prisma.TransactionClient, input: {
  agreementId:string;receiptId:string|null;evidenceVersion:number;componentEvidence:unknown;
  setupFeeCents:number;setupTaxCents:number;downPaymentCents:number;totalCents:number;
  status:string;agreementDepositCents:number;
}) {
  const deposits=await tx.deposit.findMany({where:{agreementId:input.agreementId}});
  const expected=input.evidenceVersion===2?signedReserveAmount(input):0;
  if(input.status!=="SETTLED"){
    if(deposits.some(row=>row.amountCents>0))
      throw new Error("Unsettled signing payment has a deposit liability requiring reconciliation.");
    return null;
  }
  if(expected===0){
    if(deposits.some(row=>row.amountCents>0))
      throw new Error("Other refundable deposits require finance reconciliation before cancelling.");
    return null;
  }
  const reserve=deposits[0];
  if(deposits.length!==1 || !reserve || reserve.sourceReceiptId!==input.receiptId ||
     reserve.amountCents!==expected || !reserve.refundable || reserve.refundedAt ||
     reserve.refundedAmountCents!==null || reserve.stripeRefundId)
    throw new Error("Original signing reserve has another refund decision or mismatched receipt. Reconcile it before cancelling.");
  return reserve;
}
