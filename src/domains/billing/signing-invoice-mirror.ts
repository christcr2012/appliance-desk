import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import {
  SIGNING_CREDIT_META_AGREEMENT, SIGNING_CREDIT_META_ORDER,
  SIGNING_CREDIT_META_RECEIPT, SIGNING_FIRST_INVOICE_DESCRIPTION,
} from "./signing-first-invoice-application";

/** Never mirror an unapplied W-22 first-rent credit as a rental charge. */
export async function signingInvoiceMirrorProof(
  tx: Prisma.TransactionClient, agreementId: string, stripeInvoice: Stripe.Invoice,
): Promise<{ lineId: string; description: string } | null> {
  const [entitlement, application] = await Promise.all([
    tx.signingDownPaymentCredit.findUnique({ where: { agreementId } }),
    tx.signingFirstInvoiceApplication.findUnique({ where: { agreementId } }),
  ]);
  const tagged = stripeInvoice.lines.data.filter(line =>
    line.metadata?.[SIGNING_CREDIT_META_AGREEMENT] !== undefined);
  if (!entitlement) {
    if (tagged.length) throw new Error("Unexpected signing credit on unrelated invoice.");
    return null;
  }
  if (!application) throw new Error("First-rent invoice awaiting verified provider credit application.");
  if (application.receiptId !== entitlement.receiptId ||
      application.orderFingerprint !== entitlement.orderFingerprint ||
      application.amountCents !== entitlement.amountCents) {
    throw new Error("Provider credit application differs from settled signing money.");
  }
  if (stripeInvoice.id !== application.stripeInvoiceId) {
    if (tagged.length) throw new Error("Signing credit was reused on another invoice.");
    return null;
  }
  if (stripeInvoice.lines.has_more || tagged.length !== 1) {
    throw new Error("First invoice credit is missing or its invoice lines are incomplete.");
  }
  const line = tagged[0]!;
  if (line.id !== application.stripeInvoiceLineId ||
      line.invoice !== application.stripeInvoiceId ||
      line.amount !== -application.amountCents ||
      line.metadata?.[SIGNING_CREDIT_META_AGREEMENT] !== agreementId ||
      line.metadata?.[SIGNING_CREDIT_META_ORDER] !== application.orderFingerprint ||
      line.metadata?.[SIGNING_CREDIT_META_RECEIPT] !== application.receiptId) {
    throw new Error("Stripe first invoice line does not match immutable accounting proof.");
  }
  return { lineId: line.id, description: SIGNING_FIRST_INVOICE_DESCRIPTION };
}
