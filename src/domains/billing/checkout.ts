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

/**
 * Billing starts at delivery, not at signing (Chris's explicit decision,
 * 2026-09-28 — see docs/BUSINESS-RULES.md's Billing rules). So the
 * Checkout Session created right after signing no longer starts a
 * Subscription: it only collects the one-time deposit/damage-waiver (if
 * either applies) and — always — saves a payment method on the Stripe
 * Customer for later off-session use (`setup_future_usage`), so the real
 * recurring Subscription can be created later with no further customer
 * action, once a delivery/installation job for this agreement is
 * actually marked completed (see startRecurringBillingForAgreement).
 *
 * If there's nothing to charge right now (no deposit, no damage waiver),
 * this still needs to collect *a* payment method, so it uses Stripe
 * Checkout's "setup" mode (no charge at all) instead of "payment".
 *
 * Returns the URL to redirect the customer to; nothing in our own
 * database is marked paid yet — that only happens once Stripe actually
 * confirms payment, via the checkout.session.completed webhook
 * (src/app/api/webhooks/stripe).
 */
export async function createCheckoutSessionForAgreement(agreementId: string): Promise<string> {
  const agreement = await prisma.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      lines: true,
    },
  });

  // Validates the agreement actually has something worth signing for
  // (throws "nothing to charge" if it has no rental lines at all) — the
  // one-time items (deposit/damage waiver) are what this Checkout
  // Session actually charges now; the recurring ones are billed later,
  // at delivery.
  const plan = buildCheckoutLinePlan(agreement);
  const oneTimeItems = plan.filter((item) => !item.recurring);

  const stripeCustomerId = await ensureStripeCustomer(agreement.customerId);

  const stripe = getStripeClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // Real gap fixed 2026-09-27 (found by a code review, see
  // docs/DECISIONS.md): without an idempotency key, two overlapping
  // requests to sign the same agreement (a double-click, a retried
  // request after a slow response) could each create their own separate
  // Checkout Session. Stripe treats two requests with the same key as one
  // operation — the second simply gets back the first session instead of
  // creating a new one. Stripe only remembers a key for 24 hours, so this
  // never blocks a genuinely later, separate checkout for the same
  // agreement (e.g. Chris manually re-triggering it well after the
  // original session expired unused).
  const idempotencyOptions = { idempotencyKey: `checkout-agreement-${agreement.id}` };

  const session =
    oneTimeItems.length > 0
      ? await stripe.checkout.sessions.create(
          {
            mode: "payment",
            customer: stripeCustomerId,
            payment_method_types: ["card", "us_bank_account"],
            line_items: oneTimeItems.map((item) => ({
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: item.amountCents,
                product_data: {
                  name: item.description,
                  metadata: { kind: item.kind },
                },
              },
            })),
            success_url: `${appUrl}${SUCCESS_URL_PATH}`,
            cancel_url: `${appUrl}${CANCEL_URL_PATH}`,
            // Saves the card/bank account used here on the Stripe
            // Customer for later off-session billing (the recurring
            // subscription created at delivery) — never for our own
            // servers to see or store.
            payment_intent_data: { setup_future_usage: "off_session" },
            metadata: { agreementId: agreement.id },
          },
          idempotencyOptions,
        )
      : await stripe.checkout.sessions.create(
          {
            mode: "setup",
            customer: stripeCustomerId,
            payment_method_types: ["card", "us_bank_account"],
            success_url: `${appUrl}${SUCCESS_URL_PATH}`,
            cancel_url: `${appUrl}${CANCEL_URL_PATH}`,
            setup_intent_data: { metadata: { agreementId: agreement.id } },
            metadata: { agreementId: agreement.id },
          },
          idempotencyOptions,
        );

  if (!session.url) {
    throw new Error("Stripe didn't return a Checkout URL for this session.");
  }

  return session.url;
}

/**
 * Starts the real recurring Subscription for a signed agreement — called
 * once a delivery/installation job for it is marked COMPLETED (see
 * applyJobCompletionToAppliances in src/domains/jobs), never at signing.
 * Uses the payment method saved during the signing Checkout Session
 * (Customer.stripeDefaultPaymentMethodId); if there isn't one yet (the
 * customer never completed that Checkout Session), this doesn't throw —
 * it records why on the agreement itself (billingBlockedReason) so it
 * surfaces to Chris instead of silently never getting billed, and he can
 * resolve it (send the customer a new payment link, or apply a manual
 * charge) rather than the delivery job failing to complete over it.
 *
 * Idempotent: if this agreement already has a stripeSubscriptionId,
 * nothing happens — covers a delivery job somehow being completed twice,
 * or re-running this directly.
 */
export async function startRecurringBillingForAgreement(agreementId: string): Promise<void> {
  const agreement = await prisma.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    include: {
      customer: { select: { stripeCustomerId: true, stripeDefaultPaymentMethodId: true } },
      lines: true,
    },
  });

  if (agreement.stripeSubscriptionId) return; // already billing — nothing to do

  const plan = buildCheckoutLinePlan(agreement).filter((item) => item.recurring);
  if (plan.length === 0) return; // nothing recurring on this agreement (shouldn't happen — signing requires a rental line)

  if (!agreement.customer.stripeCustomerId || !agreement.customer.stripeDefaultPaymentMethodId) {
    await prisma.rentalAgreement.update({
      where: { id: agreementId },
      data: {
        billingBlockedReason:
          "This customer hasn't completed checkout yet, so there's no saved payment method to bill — send them the checkout link again, or start billing manually once they have one on file.",
      },
    });
    return;
  }

  const taxRateId = await getOrCreateTaxRate(agreement.taxRatePermille);
  const stripe = getStripeClient();

  try {
    // Unlike Checkout Session line items, a Subscription's price_data
    // needs a real Stripe Product id (no inline product_data) — one
    // Product per rental line, created fresh each time billing starts
    // (each RentalLine's label is this agreement's own custom line, not
    // a shared catalog item, so there's nothing to reuse across
    // agreements the way getOrCreateTaxRate reuses tax rates).
    const items = await Promise.all(
      plan.map(async (item) => {
        const product = await stripe.products.create({
          name: item.description,
          metadata: { kind: item.kind, rentalLineId: item.rentalLineId ?? "", agreementId: agreement.id },
        });
        return {
          quantity: 1,
          tax_rates: taxRateId ? [taxRateId] : undefined,
          price_data: {
            currency: "usd",
            unit_amount: item.amountCents,
            recurring: { interval: "month" as const },
            product: product.id,
          },
        };
      }),
    );

    await stripe.subscriptions.create(
      {
        customer: agreement.customer.stripeCustomerId,
        default_payment_method: agreement.customer.stripeDefaultPaymentMethodId,
        items,
        metadata: { agreementId: agreement.id },
      },
      { idempotencyKey: `subscription-agreement-${agreement.id}` },
    );

    await prisma.rentalAgreement.update({
      where: { id: agreementId },
      data: { billingBlockedReason: null, billingStartedAt: new Date() },
    });
  } catch (error) {
    // A real Stripe failure (card declined by the time we tried to
    // charge it off-session, account closed, etc.) — recorded, not
    // thrown, for the same reason as above: the job that triggered this
    // already succeeded (the machine really was delivered) and must not
    // be reverted or fail just because billing hit a snag.
    const message = error instanceof Error ? error.message : "Stripe declined this charge.";
    await prisma.rentalAgreement.update({
      where: { id: agreementId },
      data: { billingBlockedReason: `Couldn't start billing: ${message}` },
    });
  }
}
