import type Stripe from "stripe";
export function validateExternalStripeRefund(
 refund: Pick<Stripe.Refund,"id"|"amount"|"charge"|"currency"|"status"|"created">,
 expected: {refundId:string;chargeId:string;amountCents:number}
) {
 const chargeId=typeof refund.charge==="string"?refund.charge:refund.charge?.id;
 if(refund.id!==expected.refundId||refund.status!=="succeeded"||
 refund.currency?.toLowerCase()!=="usd"||chargeId!==expected.chargeId||
 refund.amount!==expected.amountCents||!Number.isSafeInteger(refund.created)||
 refund.created<=0)throw new Error("Stripe TEST refund does not prove this approved return.");
 return {refundId:refund.id,originalChargeId:chargeId,amountCents:refund.amount,
  currency:"usd",status:refund.status,providerMode:"TEST_KEY",providerCreated:refund.created};
}

export type RefundReturnMethod =
  | "STRIPE_TEST_REFUND" | "MANUAL_CHECK" | "MANUAL_BANK_TRANSFER" | "MANUAL_CASH";

export function validateManualReturn(input: {
  method: RefundReturnMethod;
  reference: string;
  confirmedReturned: boolean;
  amountCents: number;
}) {
  const reference = input.reference.trim();
  if (!["MANUAL_CHECK", "MANUAL_BANK_TRANSFER", "MANUAL_CASH"].includes(input.method)) {
    throw new Error("Choose a supported manual refund method.");
  }
  if (!input.confirmedReturned || reference.length < 6 || reference.length > 120) {
    throw new Error("Confirm the actual return with its evidence reference (6–120 characters).");
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("An approved positive refund amount is required.");
  }
  return { method: input.method, reference };
}
