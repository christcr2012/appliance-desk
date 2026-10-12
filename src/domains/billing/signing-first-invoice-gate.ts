/** W-22 signing money is not yet a credit on the first delivery invoice. */
export type SigningInvoiceObligation = {
  agreementId: string;
  downPaymentCents: number;
  status: string;
  receiptId: string | null;
  orderFingerprint: string;
};
export type SigningCreditEntitlement = {
  agreementId: string;
  amountCents: number;
  receiptId: string;
  orderFingerprint: string;
};
export const SIGNING_INVOICE_SETTLEMENT_BLOCKER =
  "The first-month down payment must settle before first rental billing; review the signing payment.";
export const SIGNING_INVOICE_CREDIT_BLOCKER =
  "First-month rent was paid at signing. Billing is paused until the correct invoice credit is verified.";
export const SIGNING_INVOICE_EVIDENCE_BLOCKER =
  "The signed down-payment receipt and agreement do not reconcile. Owner review is required.";

/** Null is safe only for historical/no-credit or waived signing. */
export function firstInvoiceSigningBlocker(
  obligation: SigningInvoiceObligation | null,
  entitlement: SigningCreditEntitlement | null,
): string | null {
  if (!obligation) return entitlement ? SIGNING_INVOICE_EVIDENCE_BLOCKER : null;
  if (!Number.isSafeInteger(obligation.downPaymentCents) || obligation.downPaymentCents < 0)
    return SIGNING_INVOICE_EVIDENCE_BLOCKER;
  if (obligation.downPaymentCents === 0)
    return entitlement ? SIGNING_INVOICE_EVIDENCE_BLOCKER : null;
  if (obligation.status !== "SETTLED" || !obligation.receiptId)
    return SIGNING_INVOICE_SETTLEMENT_BLOCKER;
  if (!entitlement || entitlement.agreementId !== obligation.agreementId ||
      entitlement.receiptId !== obligation.receiptId ||
      entitlement.orderFingerprint !== obligation.orderFingerprint ||
      entitlement.amountCents !== obligation.downPaymentCents)
    return SIGNING_INVOICE_EVIDENCE_BLOCKER;
  return SIGNING_INVOICE_CREDIT_BLOCKER;
}
