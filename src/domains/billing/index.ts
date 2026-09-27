import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";

export { createCheckoutSessionForAgreement, buildCheckoutLinePlan } from "./checkout";
export { processStripeWebhookEvent } from "./webhooks";

/** Every invoice, newest first — the desk-wide billing view
 * (/desk/billing). Optionally filtered to just the delinquent ones, for
 * Chris's collections view (docs/ROADMAP.md). */
export async function getInvoices(filter?: { delinquentOnly?: boolean }) {
  return prisma.invoice.findMany({
    where: filter?.delinquentOnly ? { status: "DELINQUENT" } : undefined,
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      agreement: { select: { id: true } },
      lineItems: true,
      payments: true,
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

/** A single customer's own invoices — used by both /account/billing (the
 * signed-in customer looking at their own) and the desk's customer detail
 * page (Chris looking at a specific customer's). */
export async function getInvoicesForCustomer(customerId: string) {
  return prisma.invoice.findMany({
    where: { customerId },
    include: { lineItems: true, payments: true, refunds: true },
    orderBy: [{ createdAt: "desc" }],
  });
}

/** A link to Stripe's own hosted Customer Portal, where a customer can
 * update their payment method, switch between card/ACH, and download past
 * invoices/receipts themselves — per docs/BUSINESS-RULES.md's billing
 * rules ("via Stripe's hosted Checkout/Customer Portal"), so none of that
 * needs building here. Returns null if this customer has never actually
 * been billed yet (no Stripe customer exists for them), since the portal
 * has nothing to show until then. */
export async function createBillingPortalSession(customerId: string): Promise<string | null> {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: { stripeCustomerId: true },
  });
  if (!customer.stripeCustomerId) return null;

  const stripe = getStripeClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await stripe.billingPortal.sessions.create({
    customer: customer.stripeCustomerId,
    return_url: `${appUrl}/account`,
  });
  return session.url;
}
