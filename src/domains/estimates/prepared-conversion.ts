import type { EstimatePreparedQuote } from "./preapproval-quote";
import {
  verifyPreparedEstimateScope, type PreparedEstimateAddress,
} from "./preapproval-agreements";

export type PreparedConversionProof = {
  estimateId: string;
  customerId: string;
  reviewedQuoteFingerprint: string | null;
  reviewedOrderFingerprint: string | null;
  requestedMode: "single" | "per-property";
  requestedAddressId?: string | null;
  quoteAddresses: string[];
  prepared: PreparedEstimateAddress[];
  estimateDepositCents: number;
  estimateDepositPaidAt: Date | null;
  quote: EstimatePreparedQuote;
};

export type AdoptPreparedAgreements = {
  agreementIds: string[];
  orderFingerprint: string;
  quoteFingerprint: string;
  amountDueAtSigningCents: number;
  amountUncollectedCents: number;
  /** Conversion is never signing, dispatch, provider collection or invoice credit. */
  signed: false;
  paid: false;
  invoiced: false;
  dispatched: false;
};
export function validatePreparedConversion(
  data: PreparedConversionProof,
): AdoptPreparedAgreements {
  if (!data.estimateId || !data.customerId || !data.reviewedQuoteFingerprint ||
      !data.reviewedOrderFingerprint || !/^[a-f0-9]{64}$/.test(data.reviewedQuoteFingerprint) ||
      !/^[a-f0-9]{64}$/.test(data.reviewedOrderFingerprint))
    throw new Error("An exact reviewed immutable all-in quote must precede conversion.");
  const quote = data.quote;
  if (quote.status !== "READY" || !quote.totals || !quote.quoteFingerprint ||
      !quote.orderFingerprint ||
      quote.quoteFingerprint !== data.reviewedQuoteFingerprint ||
      quote.orderFingerprint !== data.reviewedOrderFingerprint)
    throw new Error("Reviewed amount or tax/terms evidence has changed. Resend a full offer before conversion.");
  const reserveAmounts=quote.locations.map(row=>row.reserveCents??0);
  const reconciledV2Reserve=quote.evidenceVersion===2 && Number.isSafeInteger(data.estimateDepositCents) &&
    data.estimateDepositCents>=0 && quote.totals.reserveCents===data.estimateDepositCents &&
    reserveAmounts.every(n=>Number.isSafeInteger(n)&&n>=0) &&
    reserveAmounts.reduce((sum,n)=>sum+n,0)===data.estimateDepositCents;
  if ((data.estimateDepositCents !== 0 && !reconciledV2Reserve) || data.estimateDepositPaidAt)
    throw new Error("Early refundable estimate deposits require separate evidence and allocation review; conversion cannot infer funds.");
  const agreementIds = verifyPreparedEstimateScope(data.prepared,
    data.quoteAddresses, data.estimateId, data.customerId);
  if (data.requestedMode === "single" &&
      (data.quoteAddresses.length !== 1 ||
        data.quoteAddresses[0] !== data.requestedAddressId))
    throw new Error("Single-property conversion conflicts with the originally accepted address set.");
  if (data.requestedMode === "per-property" && data.quoteAddresses.length > 500)
    throw new Error("Unbounded property conversion is not supported.");
  if (quote.locations.length !== agreementIds.length ||
      quote.locations.some(row => !agreementIds.includes(row.agreementId) ||
        !data.quoteAddresses.includes(row.serviceAddressId)))
    throw new Error("Reviewed quote and prepared agreement identities do not match.");
  const actualSigningTotal = quote.locations.reduce((sum, loc) => sum + loc.signingAmountCents, 0);
  if (!Number.isSafeInteger(actualSigningTotal) || actualSigningTotal < 0 ||
      actualSigningTotal !== quote.totals.dueAtSigningCents)
    throw new Error("Signing obligations do not sum to the original reviewed quote.");
  return {
    agreementIds,
    orderFingerprint: quote.orderFingerprint,
    quoteFingerprint: quote.quoteFingerprint,
    amountDueAtSigningCents: actualSigningTotal,
    amountUncollectedCents: actualSigningTotal,
    signed: false, paid: false, invoiced: false, dispatched: false,
  };
}
export function validateConvertedEstimateReplay(
  rows: readonly {
    id: string; customerId: string; sourceEstimateId: string | null;
    serviceAddressId: string;
  }[],
  expected: { estimateId: string; customerId: string | null },
): string[] {
  if (!expected.customerId || !expected.estimateId || !rows.length || rows.length > 500 ||
      new Set(rows.map(row => row.id)).size !== rows.length ||
      new Set(rows.map(row => row.serviceAddressId)).size !== rows.length ||
      rows.some(row => row.customerId !== expected.customerId ||
        row.sourceEstimateId !== expected.estimateId || !row.serviceAddressId))
    throw new Error("Previously converted agreements fail customer/scope consistency checks. Review before replay.");
  return rows.map(row => row.id).sort();
}
