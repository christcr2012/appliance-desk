import type Stripe from "stripe";

/** A signed first-month payment can only be offset on its first subscription invoice. */
export const SIGNING_FIRST_INVOICE_DESCRIPTION = "Credit – First month paid at signing";
export const SIGNING_CREDIT_META_AGREEMENT = "signing_credit_agreement";
export const SIGNING_CREDIT_META_ORDER = "signing_credit_order";
export const SIGNING_CREDIT_META_RECEIPT = "signing_credit_receipt";

export type FrozenSigningCredit = {
  agreementId: string;
  receiptId: string;
  orderFingerprint: string;
  amountCents: number;
};

export function signingFirstInvoiceItem(credit: FrozenSigningCredit, product: string):
  Stripe.SubscriptionCreateParams.AddInvoiceItem {
  if (!credit.agreementId || !credit.receiptId ||
      !/^[0-9a-f]{64}$/.test(credit.orderFingerprint) ||
      !Number.isSafeInteger(credit.amountCents) || credit.amountCents <= 0 ||
      !product.startsWith("prod_")) {
    throw new Error("Invalid frozen signing credit for the first invoice.");
  }
  return {
    price_data: { currency: "usd", product, unit_amount: -credit.amountCents },
    quantity: 1,
    discountable: false,
    // Signing payment is an amount already collected, not a second taxable sale.
    // Exclude subscription default tax rates from this negative payment offset.
    tax_rates: [],
    metadata: {
      [SIGNING_CREDIT_META_AGREEMENT]: credit.agreementId,
      [SIGNING_CREDIT_META_ORDER]: credit.orderFingerprint,
      [SIGNING_CREDIT_META_RECEIPT]: credit.receiptId,
    },
  };
}

export type VerifiedFirstInvoiceCredit = {
  agreementId: string;
  stripeSubscriptionId: string;
  stripeInvoiceId: string;
  stripeInvoiceLineId: string;
  orderFingerprint: string;
  receiptId: string;
  amountCents: number;
};

/** Strict Stripe readback; this verifies invoice CREDIT, never payment success. */
export function verifySigningFirstInvoiceCredit(
  credit: FrozenSigningCredit,
  subscriptionId: string,
  stripeCustomerId: string,
  invoice: Stripe.Invoice,
  lines: Stripe.InvoiceLineItem[],
  hasMore: boolean,
): VerifiedFirstInvoiceCredit {
  const parent = invoice.parent?.subscription_details?.subscription;
  const invoiceSubscriptionId = typeof parent === "string" ? parent : parent?.id;
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (invoice.livemode || invoice.billing_reason !== "subscription_create" ||
      invoice.currency !== "usd" || invoiceSubscriptionId !== subscriptionId ||
      customerId !== stripeCustomerId || !subscriptionId.startsWith("sub_") ||
      !invoice.id.startsWith("in_") || hasMore ||
      invoice.status === "void" || invoice.status === "uncollectible") {
    throw new Error("First invoice provider/customer/subscription evidence is not verifiable.");
  }
  const matched = lines.filter(line =>
    line.metadata?.[SIGNING_CREDIT_META_AGREEMENT] === credit.agreementId);
  if (matched.length !== 1) {
    throw new Error("Expected exactly one agreement-bound first-invoice credit line.");
  }
  const line = matched[0]!;
  if (line.livemode || line.invoice !== invoice.id ||
      line.metadata?.[SIGNING_CREDIT_META_ORDER] !== credit.orderFingerprint ||
      line.metadata?.[SIGNING_CREDIT_META_RECEIPT] !== credit.receiptId ||
      line.amount !== -credit.amountCents || !line.id) {
    throw new Error("First-invoice credit line differs from frozen settled receipt.");
  }
  return {
    agreementId: credit.agreementId,
    stripeSubscriptionId: subscriptionId,
    stripeInvoiceId: invoice.id,
    stripeInvoiceLineId: line.id,
    orderFingerprint: credit.orderFingerprint,
    receiptId: credit.receiptId,
    amountCents: credit.amountCents,
  };
}
