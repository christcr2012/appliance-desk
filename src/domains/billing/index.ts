import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { businessMonthBounds } from "@/lib/business-date";
import { computeMrrTrend, revenuePeriod } from "./revenue";

export { createCheckoutSessionForAgreement, buildCheckoutLinePlan } from "./checkout";
export { processStripeWebhookEvent } from "./webhooks";
export { computeMrrTrend } from "./revenue";
export type { MrrTrendPoint } from "./revenue";
export { sendUpcomingBillingReminders } from "./reminders";
export { getCustomerStatement, getCustomersWithOpenBalances } from "./statements";
export type {
  CustomerStatement,
  StatementProperty,
  StatementInvoice,
  StatementLineItem,
} from "./statements";
export { recordManualPayment, writeOffInvoice } from "./manual-payments";
export type {
  ManualPaymentInput,
  ManualPaymentMethod,
  ManualPaymentResult,
} from "./manual-payments";
export { applyLateFees, sendLateFeeDigestToChris } from "./late-fees";
export type { LateFeeApplication } from "./late-fees";

export async function getInvoicesCount(filter?: {
  delinquentOnly?: boolean;
}): Promise<number> {
  return prisma.invoice.count({
    where: filter?.delinquentOnly ? { status: "DELINQUENT" } : undefined,
  });
}

export async function getInvoicesPage(
  filter: { delinquentOnly?: boolean } | undefined,
  skip: number,
  pageSize: number,
) {
  return prisma.invoice.findMany({
    where: filter?.delinquentOnly ? { status: "DELINQUENT" } : undefined,
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      billingPeriodStart: true,
      amountDueCents: true,
      amountPaidCents: true,
      customer: {
        select: {
          id: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take: pageSize,
  });
}

/** Stripe-hosted Customer Portal; local servers never handle card/bank data. */
export async function createBillingPortalSession(
  customerId: string,
): Promise<string | null> {
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

/**
 * Operational revenue dashboard. MRR/ARR remain agreement-rate metrics.
 * "Collected" is gross cash received and therefore comes from Receipt, not
 * Payment allocations: one $400 combined check is $400 once even when it
 * allocates across several invoices, and its month is based on receivedOn.
 */
export async function getRevenueDashboard(now = new Date()) {
  const period = revenuePeriod(now, true);
  const cashMonth = businessMonthBounds(now);
  const cashPeriod = { gte: cashMonth.start, lte: now };

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
    prisma.rentalAgreement.findMany({
      where: { status: "ACTIVE", billingStartedAt: { not: null, lte: now } },
      select: {
        customerId: true,
        lines: { select: { monthlyPriceCents: true } },
      },
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
      where: { status: "ACTIVE", billingStartedAt: { not: null, lte: now } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    prisma.rentalAgreement.count({ where: { startDate: period } }),
    prisma.rentalAgreement.count({
      where: {
        status: { in: ["ENDED", "CANCELLED"] },
        updatedAt: period,
      },
    }),
    prisma.receipt.aggregate({
      where: { receivedOn: cashPeriod },
      _sum: { amountCents: true },
    }),
    prisma.receipt.aggregate({
      where: { receivedOn: revenuePeriod(now, false) },
      _sum: { amountCents: true },
    }),
    prisma.invoice.findMany({
      where: {
        status: { in: ["DELINQUENT", "OPEN", "PARTIALLY_PAID"] },
        dueDate: { lt: now },
      },
      select: { amountDueCents: true, amountPaidCents: true },
    }),
    prisma.payment.count({
      where: { status: "failed", createdAt: period },
    }),
  ]);

  const mrrCents = activeAgreements.reduce(
    (sum, agreement) =>
      sum +
      agreement.lines.reduce(
        (lineSum, line) => lineSum + line.monthlyPriceCents,
        0,
      ),
    0,
  );
  const outstandingInvoices = pastDueInvoices.filter(
    (invoice) => invoice.amountDueCents > invoice.amountPaidCents,
  );
  const pastDueCents = outstandingInvoices.reduce(
    (sum, invoice) =>
      sum + Math.max(0, invoice.amountDueCents - invoice.amountPaidCents),
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
    pastDueInvoiceCount: outstandingInvoices.length,
    failedPaymentsThisMonth,
    mrrTrend: computeMrrTrend(allAgreementsForTrend, 6, now),
  };
}
