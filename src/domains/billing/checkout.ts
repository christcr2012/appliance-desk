import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";

// ---------------------------------------------------------------------------
// Phase 6B — turning a signed rental agreement into a real Stripe
// subscription. See docs/BUSINESS-RULES.md's "Billing rules" for the
// policy this implements: anniversary billing (Stripe already bills a
// subscription on the day-of-month it was created, so no special anchor
// is needed), deposits charged as real money up front (bundled into the
// same Checkout Session as a one-time item), both cards and ACH offered,
// billing in advance (Stripe charges the first period immediately when
// the subscription is created).
//
// Card/bank details never touch our own servers — everything below uses
// Stripe's own hosted Checkout, per that same business rule.
// ---------------------------------------------------------------------------

/** Only what buildCheckoutLinePlan actually needs from an agreement and
 * its lines — kept deliberately narrow (rather than picking fields off
 * the full generated Prisma type) so the pure math in that function stays
 * simple to unit-test with plain object literals, with no database or
 * generated-client involvement at all. */
type LinePlanInput = {
  lines: { id: string; label: string; monthlyPriceCents: number }[];
  depositCents: number;
  damageWaiverCents: number;
};

/** One line of what a Checkout Session will actually charge/subscribe to.
 * Kept separate from the Stripe API call itself so the math (what gets
 * charged now vs. every month, and how much) is unit-testable without a
 * network call — see tests/billing.test.ts. */
export type CheckoutLinePlan = {
  kind: "RENTAL" | "DEPOSIT" | "DAMAGE_WAIVER";
  description: string;
  amountCents: number;
  recurring: boolean;
  rentalLineId: string | null;
};

/** Pure — no database or Stripe access. Turns an agreement's frozen price
 * snapshot (its rental lines, deposit, damage waiver) into the flat list
 * of charges a Checkout Session needs to create: the recurring monthly
 * rent lines (these become the subscription) plus the one-time deposit
 * and damage-waiver charges collected on that very first invoice, exactly
 * once. Throws if there's nothing to charge at all, since sending Stripe
 * an empty Checkout Session would be a silent no-op, not a safe default. */
export function buildCheckoutLinePlan(agreement: LinePlanInput): CheckoutLinePlan[] {
  const plan: CheckoutLinePlan[] = agreement.lines.map((line) => ({
    kind: "RENTAL" as const,
    description: line.label,
    amountCents: line.monthlyPriceCents,
    recurring: true,
    rentalLineId: line.id,
  }));

  if (agreement.depositCents > 0) {
    plan.push({
      kind: "DEPOSIT",
      description: "Security deposit",
      amountCents: agreement.depositCents,
      recurring: false,
      rentalLineId: null,
    });
  }
  if (agreement.damageWaiverCents > 0) {
    plan.push({
      kind: "DAMAGE_WAIVER",
      description: "Damage waiver",
      amountCents: agreement.damageWaiverCents,
      recurring: false,
      rentalLineId: null,
    });
  }

  if (plan.length === 0) {
    throw new Error(
      "This agreement has nothing to charge (no rental lines, deposit, or damage waiver) — add at least one before billing it.",
    );
  }

  return plan;
}

/** Creates the real Stripe Customer for this Customer's first-ever charge,
 * or returns the existing one — never recreated, per the schema comment
 * on Customer.stripeCustomerId. */
export async function ensureStripeCustomer(customerId: string): Promise<string> {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    include: { user: { select: { name: true, email: true } } },
  });

  if (customer.stripeCustomerId) {
    return customer.stripeCustomerId;
  }

  const stripe = getStripeClient();
  const stripeCustomer = await stripe.customers.create({
    name: customer.user.name ?? undefined,
    email: customer.user.email,
    metadata: { customerId: customer.id },
  });

  await prisma.customer.update({
    where: { id: customerId },
    data: { stripeCustomerId: stripeCustomer.id },
  });

  return stripeCustomer.id;
}

/** Finds an existing Stripe Tax Rate matching this exact percentage
 * (inclusive: false, since docs/BUSINESS-RULES.md's pricing is always
 * tax-exclusive), or creates one — so repeat agreements at the same rate
 * (the common case; most customers share Chris's one configured sales-tax
 * rate) don't pile up duplicate Tax Rate objects in the Stripe dashboard.
 * Returns null for a 0% rate, since a 0% Tax Rate object isn't meaningful
 * and Checkout doesn't need one to charge no tax. */
async function getOrCreateTaxRate(taxRatePermille: number): Promise<string | null> {
  if (taxRatePermille <= 0) return null;

  const stripe = getStripeClient();
  // taxRatePermille is tenths of a percent, same convention used
  // everywhere else it's displayed (e.g. src/app/(public)/pricing/page.tsx)
  // — 73 means 7.3%, not 73%.
  const percentage = taxRatePermille / 10;
  const existing = await stripe.taxRates.list({ limit: 100, active: true });
  const match = existing.data.find(
    (rate) => !rate.inclusive && Math.abs(rate.percentage - percentage) < 0.0001,
  );
  if (match) return match.id;

  const created = await stripe.taxRates.create({
    display_name: "Sales tax",
    percentage,
    inclusive: false,
    country: "US",
    state: "CO",
  });
  return created.id;
}

const SUCCESS_URL_PATH = "/account?billing=success";
const CANCEL_URL_PATH = "/account?billing=cancelled";

/** The real integration point: builds and creates the actual Stripe
 * Checkout Session for a just-signed agreement, in subscription mode so
 * the recurring rent lines become a real Stripe Subscription (billed
 * immediately for this first period, then automatically every month on
 * this same day going forward — anniversary billing, no extra config
 * needed) while the deposit/damage-waiver amounts ride along as one-time
 * charges on that same first invoice only. Returns the URL to redirect
 * the customer to; nothing in our own database is marked paid yet — that
 * only happens once Stripe actually confirms payment, via the
 * checkout.session.completed webhook (src/app/api/webhooks/stripe). */
export async function createCheckoutSessionForAgreement(agreementId: string): Promise<string> {
  const agreement = await prisma.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      lines: true,
    },
  });

  const plan = buildCheckoutLinePlan(agreement);
  const stripeCustomerId = await ensureStripeCustomer(agreement.customerId);
  const taxRateId = await getOrCreateTaxRate(agreement.taxRatePermille);

  const stripe = getStripeClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const lineItems = plan.map((item) => ({
    quantity: 1,
    tax_rates: item.recurring && taxRateId ? [taxRateId] : undefined,
    price_data: {
      currency: "usd",
      unit_amount: item.amountCents,
      product_data: {
        name: item.description,
        metadata: { kind: item.kind, rentalLineId: item.rentalLineId ?? "" },
      },
      ...(item.recurring ? { recurring: { interval: "month" as const } } : {}),
    },
  }));

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: stripeCustomerId,
      payment_method_types: ["card", "us_bank_account"],
      line_items: lineItems,
      success_url: `${appUrl}${SUCCESS_URL_PATH}`,
      cancel_url: `${appUrl}${CANCEL_URL_PATH}`,
      subscription_data: {
        metadata: { agreementId: agreement.id },
      },
      metadata: { agreementId: agreement.id },
    },
    // Real gap fixed 2026-09-27 (found by a code review, see
    // docs/DECISIONS.md): without this, two overlapping requests to sign
    // the same agreement (a double-click, or a retried request after a
    // slow response) could each create their own separate Checkout
    // Session — not a lost-money bug, but the customer could end up with
    // two different payment links for the same rental. Stripe treats two
    // requests with the same idempotency key as one operation: the second
    // one simply gets back the first one's session instead of creating a
    // new one. Stripe only remembers a key for 24 hours, so this never
    // blocks a genuinely later, separate checkout for the same agreement
    // (e.g. Chris manually re-triggering billing well after the original
    // session expired unused) — by then the key has aged out and a fresh
    // request just proceeds normally.
    { idempotencyKey: `checkout-agreement-${agreement.id}` },
  );

  if (!session.url) {
    throw new Error("Stripe didn't return a Checkout URL for this session.");
  }

  return session.url;
}
