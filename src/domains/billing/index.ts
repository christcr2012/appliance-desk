import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { computeMrrTrend } from "./revenue";

export { createCheckoutSessionForAgreement, buildCheckoutLinePlan } from "./checkout";
export { processStripeWebhookEvent } from "./webhooks";
export { computeMrrTrend } from "./revenue";
export type { MrrTrendPoint } from "./revenue";
export { sendUpcomingBillingReminders } from "./reminders";
export { getCustomerStatement, getCustomersWithOpenBalances } from "./statements";
export type { CustomerStatement, StatementProperty, StatementInvoice, StatementLineItem } from "./statements";
export { recordManualPayment, writeOffInvoice } from "./manual-payments";
export type { ManualPaymentInput, ManualPaymentMethod, ManualPaymentResult } from "./manual-payments";
export { applyLateFees, sendLateFeeDigestToChris } from "./late-fees";
export type { LateFeeApplication } from "./late-fees";

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

// ---------------------------------------------------------------------------
// MRR/ARR financial dashboard (2026-09-27, /desk/revenue) — see
// src/domains/billing/revenue.ts for computeMrrTrend's own documented
// approximation, and docs/DECISIONS.md for the full writeup.
// ---------------------------------------------------------------------------

/** Everything /desk/revenue shows, in one call. Real Stripe-confirmed
 * money (collected revenue, past-due, failed payments) comes straight
 * from Invoice/Payment — nothing estimated there. MRR/ARR and the trend
 * line are reconstructed from agreements' own agreed pricing (see
 * computeMrrTrend's own doc comment for what that does and doesn't
 * capture). */
export async function getRevenueDashboard() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    activeAgreements,
    allAgreementsForTrend,
    activeCustomerIds,
    newRentalsThisMonth,
    endedOrCancelledThisMonth,
    collectedThisMonthCents,
    collectedAllTimeCents,
    pastDueInvoices,
    failedPaymentsThisMonth,
  ] = await Promise.all([
    // Billing starts at delivery, not at signing (2026-09-28): an ACTIVE
    // agreement with no billingStartedAt yet is signed but not delivered,
    // so it isn't generating any recurring revenue yet — MRR/ARR and the
    // active-rental/active-customer counts below only count ones where
    // billing has actually started.
    prisma.rentalAgreement.findMany({
      where: { status: "ACTIVE", billingStartedAt: { not: null } },
      select: { customerId: true, lines: { select: { monthlyPriceCents: true } } },
    }),
    prisma.rentalAgreement.findMany({
      where: { billingStartedAt: { not: null } },
      select: {
        billingStartedAt: true,
        endDate: true,
        lines: { select: { monthlyPriceCents: true } },
      },
    }),
    prisma.rentalAgreement.findMany({
      where: { status: "ACTIVE", billingStartedAt: { not: null } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    prisma.rentalAgreement.count({
      where: { startDate: { gte: startOfMonth } },
    }),
    prisma.rentalAgreement.count({
      where: {
        status: { in: ["ENDED", "CANCELLED"] },
        updatedAt: { gte: startOfMonth },
      },
    }),
    prisma.payment.aggregate({
      where: { status: "succeeded", createdAt: { gte: startOfMonth } },
      _sum: { amountCents: true },
    }),
    prisma.payment.aggregate({
      where: { status: "succeeded" },
      _sum: { amountCents: true },
    }),
    prisma.invoice.findMany({
      where: {
        status: { in: ["DELINQUENT", "OPEN"] },
        dueDate: { lt: now },
      },
      select: { amountDueCents: true, amountPaidCents: true },
    }),
    prisma.payment.count({
      where: { status: "failed", createdAt: { gte: startOfMonth } },
    }),
  ]);

  const mrrCents = activeAgreements.reduce(
    (sum, a) => sum + a.lines.reduce((s, l) => s + l.monthlyPriceCents, 0),
    0,
  );

  const pastDueCents = pastDueInvoices.reduce(
    (sum, inv) => sum + Math.max(0, inv.amountDueCents - inv.amountPaidCents),
    0,
  );

  return {
    mrrCents,
    arrCents: mrrCents * 12,
    activeRentalCount: activeAgreements.length,
    activeCustomerCount: activeCustomerIds.length,
    newRentalsThisMonth,
    endedOrCancelledThisMonth,
    collectedThisMonthCents: collectedThisMonthCents._sum.amountCents ?? 0,
    collectedAllTimeCents: collectedAllTimeCents._sum.amountCents ?? 0,
    pastDueCents,
    pastDueInvoiceCount: pastDueInvoices.length,
    failedPaymentsThisMonth,
    mrrTrend: computeMrrTrend(allAgreementsForTrend, 6, now),
  };
}
