import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import { getHostedPaymentUrl } from "@/domains/billing/payment-link";
import { createLocalInvoiceCheckout, LocalInvoiceCheckoutError } from "@/domains/billing/local-invoice-checkout";

/** W-20: "Pay now" for a customer's own overdue invoice, through the invoice's Stripe-hosted page. */
export class PayNowError extends Error {}

const PAYABLE = ["OPEN", "PARTIALLY_PAID", "DELINQUENT"];

export function isPayNowEligible(
  inv: { status: string; dueDate: Date | null; balanceCents: number; isLocalInvoice: boolean; isShopSale?: boolean },
  now: Date,
): boolean {
  if (inv.balanceCents <= 0 || !PAYABLE.includes(inv.status)) return false;
  // A counter sale to a customer with an account can be paid by card whenever something is owed (M-3).
  if (inv.isLocalInvoice) return inv.isShopSale === true;
  if (inv.status === "DELINQUENT") return true;
  return inv.dueDate !== null && businessDateKey(inv.dueDate) < businessDateKey(now);
}

/** Resolves the signed-in customer from the user id; any other customer's invoice looks exactly like a missing one. */
export async function getPayNowUrl(userId: string, invoiceId: string, now = new Date()): Promise<string> {
  const customer = await prisma.customer.findUnique({ where: { userId }, select: { id: true, archivedAt: true } });
  if (!customer || customer.archivedAt) throw new PayNowError("We couldn't find that bill.");
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, customerId: customer.id },
    select: { status: true, dueDate: true, amountDueCents: true, amountPaidCents: true, stripeInvoiceId: true, saleKind: true },
  });
  if (!invoice) throw new PayNowError("We couldn't find that bill.");
  const owed = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
  if (!isPayNowEligible({ status: invoice.status, dueDate: invoice.dueDate, balanceCents: owed, isLocalInvoice: invoice.stripeInvoiceId === null, isShopSale: invoice.saleKind === "SHOP_SALE" }, now)) {
    throw new PayNowError("This bill can't be paid online right now.");
  }
  if (invoice.stripeInvoiceId === null) {
    try {
      return (await createLocalInvoiceCheckout({ kind: "portal", userId }, invoiceId)).url;
    } catch (error) {
      if (error instanceof LocalInvoiceCheckoutError) throw new PayNowError("This bill can't be paid online right now.");
      throw new PayNowError("The payment page isn't available right now. Please try again shortly or contact us.");
    }
  }
  try {
    return await getHostedPaymentUrl(invoice.stripeInvoiceId!, owed);
  } catch {
    throw new PayNowError("The payment page isn't available right now. Please try again shortly or contact us.");
  }
}
