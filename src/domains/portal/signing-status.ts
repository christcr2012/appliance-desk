import { verifySigningV2Extension, type SigningV2Extension } from "@/domains/billing/signing-v2-lines";
/**
 * Only immutable, agreement-owned W-22 evidence belongs in the customer portal.
 * A signed obligation is not itself a receipt, and first-invoice credit is a
 * separate accounting event. Keep the distinction at the DTO boundary.
 */
export type CustomerSigningEvidence = {
  agreementId?: string;
  evidenceVersion?: number;
  componentEvidence?: unknown;
  setupFeeCents: number;
  setupTaxCents: number;
  downPaymentCents: number;
  totalCents: number;
  status: string;
  signedAt: Date;
  receipt: {
    customerId: string;
    amountCents: number;
    receivedOn: Date;
  } | null;
};

export type CustomerSigningSummary = {
  additionalCharges?: Array<{label:string;amountCents:number}>;
  setupFeeCents: number | null;
  setupTaxCents: number | null;
  downPaymentCents: number | null;
  totalCents: number | null;
  status: "NOT_DUE" | "AWAITING_PAYMENT" | "RECEIVED" | "REVIEW_REQUIRED";
  receivedOn: Date | null;
};

const validCents = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function customerSigningSummary(
  payment: CustomerSigningEvidence | null,
  customerId: string,
): CustomerSigningSummary | null {
  if (!payment) return null;
  const { setupFeeCents, setupTaxCents, downPaymentCents, totalCents, status, receipt } = payment;
  const result: Pick<CustomerSigningSummary,"setupFeeCents"|"setupTaxCents"|"downPaymentCents"|"totalCents"|"additionalCharges"> = { setupFeeCents, setupTaxCents, downPaymentCents, totalCents };
  let valid = [setupFeeCents, setupTaxCents, downPaymentCents, totalCents].every(validCents);
  if(payment.evidenceVersion===2){
    try{
      const extension=verifySigningV2Extension(payment.componentEvidence as SigningV2Extension,{
        agreementId:payment.agreementId??"",setupFeeCents,setupTaxCents,downPaymentCents,allInCents:totalCents,
      });
      const labels={DELIVERY:"Delivery",INSTALLATION:"Installation",REMOVAL:"Removal",DAMAGE_WAIVER:"Damage waiver",COMMERCIAL_RESERVE:"Refundable commercial reserve",RETAIL_DELIVERY_FEE:"Retail delivery fee"} as const;
      result.additionalCharges=extension.components.filter(row=>row.category in labels&&row.disposition==="DUE_NOW"&&row.amountCents>0)
        .map(row=>({label:labels[row.category as keyof typeof labels],amountCents:row.amountCents}));
      const serviceTax=extension.taxLines.filter(row=>!row.componentId.endsWith(":ADMINISTRATIVE_SETUP")).reduce((sum,row)=>sum+row.taxCents,0);
      if(serviceTax>0)result.additionalCharges.push({label:"Other service tax",amountCents:serviceTax});
    }catch{valid=false;}
  }else{
    valid=valid&&(payment.evidenceVersion===undefined||payment.evidenceVersion===1)&&
      !payment.componentEvidence&&setupFeeCents+setupTaxCents+downPaymentCents===totalCents;
  }
  if (!valid || !customerId || !(payment.signedAt instanceof Date)
      || !Number.isFinite(payment.signedAt.getTime())) {
    return { setupFeeCents: null, setupTaxCents: null, downPaymentCents: null,
      totalCents: null, status: "REVIEW_REQUIRED", receivedOn: null };
  }
  if (status === "NOT_DUE" && totalCents === 0 && !receipt) {
    return { ...result, status: "NOT_DUE", receivedOn: null };
  }
  if (status === "AWAITING_PAYMENT" && totalCents > 0 && !receipt) {
    return { ...result, status: "AWAITING_PAYMENT", receivedOn: null };
  }
  if (status === "SETTLED" && totalCents > 0 && receipt
      && receipt.customerId === customerId && receipt.amountCents === totalCents
      && receipt.receivedOn instanceof Date
      && Number.isFinite(receipt.receivedOn.getTime())) {
    return { ...result, status: "RECEIVED", receivedOn: receipt.receivedOn };
  }
  // Unknown provider state, stale data and a foreign/wrong-amount receipt
  // can never be translated into "paid" in a customer-facing view.
  return { ...result, status: "REVIEW_REQUIRED", receivedOn: null };
}
