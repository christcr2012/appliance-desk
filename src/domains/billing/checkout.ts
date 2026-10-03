import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { businessDateEnd, businessDateKey, fixedTermEndDate } from "@/lib/business-date";
import {
  RetryLater,
  claimProviderOperation,
  completeProviderOperation,
  runProviderCall,
} from "./provider-ops";

// ---------------------------------------------------------------------------
// Stripe checkout and subscription creation. Card/bank details never touch
// our servers; hosted Stripe Checkout saves a provider payment method and the
// recurring subscription starts only after physical delivery completes.
// ---------------------------------------------------------------------------

type LinePlanInput = {
  lines: { id: string; label: string; monthlyPriceCents: number }[];
  depositCents: number;
  damageWaiverCents: number;
};

export type CheckoutLinePlan = {
  kind: "RENTAL" | "DEPOSIT" | "DAMAGE_WAIVER";
  description: string;
  amountCents: number;
  recurring: boolean;
  rentalLineId: string | null;
};

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

/**
 * Return the one Stripe Customer linked to this local Customer. A durable
 * provider operation makes concurrent first-billing attempts collapse to one
 * Stripe write without holding a database transaction across the network.
 */
export async function ensureStripeCustomer(customerId: string): Promise<string> {
  const idempotencyKey = `customer-create-${customerId}`;

  const claimed = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; stripeCustomerId: string | null }>>`
      SELECT "id", "stripeCustomerId"
      FROM "Customer"
      WHERE "id" = ${customerId}
      FOR UPDATE
    `;
    if (!locked[0]) {
      throw new Error(`Customer ${customerId} does not exist.`);
    }
    if (locked[0].stripeCustomerId) {
      return { done: true as const, providerObjectId: locked[0].stripeCustomerId };
    }

    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      include: { user: { select: { name: true, email: true } } },
    });
    const claim = await claimProviderOperation(tx, {
      kind: "CUSTOMER_CREATE",
      subjectType: "Customer",
      subjectId: customerId,
      idempotencyKey,
    });

    if (claim.done) {
      await tx.customer.update({
        where: { id: customerId },
        data: { stripeCustomerId: claim.providerObjectId },
      });
      return { done: true as const, providerObjectId: claim.providerObjectId };
    }

    return {
      done: false as const,
      opId: claim.opId,
      idempotencyKey: claim.idempotencyKey,
      name: customer.user.name,
      email: customer.user.email,
    };
  });

  if (claimed.done) return claimed.providerObjectId;

  const stripe = getStripeClient();
  const providerResult = await runProviderCall(() =>
    stripe.customers.create(
      {
        name: claimed.name ?? undefined,
        email: claimed.email,
        metadata: { customerId },
      },
      { idempotencyKey: claimed.idempotencyKey },
    ),
  );

  if (!providerResult.ok) {
    await prisma.$transaction((tx) =>
      completeProviderOperation(
        tx,
        claimed.opId,
        providerResult.outcome === "UNKNOWN"
          ? { status: "UNKNOWN", error: providerResult.error }
          : { status: "FAILED", error: providerResult.error },
      ),
    );
    throw new Error("Couldn't set up billing for this customer — try again in a minute.");
  }

  const stripeCustomerId = providerResult.value.id;
  const finalId = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; stripeCustomerId: string | null }>>`
      SELECT "id", "stripeCustomerId"
      FROM "Customer"
      WHERE "id" = ${customerId}
      FOR UPDATE
    `;
    const customer = locked[0];
    if (!customer) {
      await completeProviderOperation(tx, claimed.opId, {
        status: "DRIFT",
        providerObjectId: stripeCustomerId,
        note: `Stripe customer ${stripeCustomerId} was created after local customer ${customerId} disappeared.`,
      });
      return null;
    }

    if (!customer.stripeCustomerId) {
      await tx.customer.update({
        where: { id: customerId },
        data: { stripeCustomerId },
      });
      await completeProviderOperation(tx, claimed.opId, {
        status: "SUCCEEDED",
        providerObjectId: stripeCustomerId,
      });
      return stripeCustomerId;
    }

    if (customer.stripeCustomerId === stripeCustomerId) {
      await completeProviderOperation(tx, claimed.opId, {
        status: "SUCCEEDED",
        providerObjectId: stripeCustomerId,
      });
      return stripeCustomerId;
    }

    await completeProviderOperation(tx, claimed.opId, {
      status: "DRIFT",
      providerObjectId: stripeCustomerId,
      note: `Stripe returned ${stripeCustomerId}, but customer ${customerId} is already linked to ${customer.stripeCustomerId}.`,
    });
    return customer.stripeCustomerId;
  });

  if (!finalId) {
    throw new Error("Customer disappeared while billing was being set up.");
  }
  return finalId;
}

/** Reuse a matching exclusive Stripe tax rate; 0% needs no Stripe object. */
async function getOrCreateTaxRate(taxRateMilliPercent: number): Promise<string | null> {
  if (taxRateMilliPercent <= 0) return null;

  const stripe = getStripeClient();
  // Thousandths of a percent -> Stripe percentage (Stripe accepts up to 4 decimals).
  const percentage = taxRateMilliPercent / 1000;
  // Walk every page so a rate that already exists is reused, not duplicated.
  let match: { id: string } | undefined;
  let startingAfter: string | undefined;
  for (let pageNumber = 0; pageNumber < 100 && !match; pageNumber += 1) {
    const page = await stripe.taxRates.list({
      limit: 100,
      active: true,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    match = page.data.find(
      (rate) => !rate.inclusive && Math.abs(rate.percentage - percentage) < 0.00005,
    );
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
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
 * Signing checkout charges only one-time deposit/waiver amounts and saves a
 * payment method. Recurring rental billing starts later, at delivery.
 */
export async function createCheckoutSessionForAgreement(agreementId: string): Promise<string> {
  const agreement = await prisma.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    include: {
      customer: { include: { user: { select: { name: true, email: true } } } },
      lines: true,
    },
  });

  const alreadyHasDeposit = (await prisma.deposit.count({ where: { agreementId } })) > 0;
  const plan = buildCheckoutLinePlan({
    lines: agreement.lines,
    depositCents: alreadyHasDeposit ? 0 : agreement.depositCents,
    damageWaiverCents: agreement.damageWaiverCents,
  });
  const oneTimeItems = plan.filter((item) => !item.recurring);
  const stripeCustomerId = await ensureStripeCustomer(agreement.customerId);
  const stripe = getStripeClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
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

/** Collect an estimate deposit immediately after online approval. */
export async function createDepositCheckoutSessionForEstimate(
  estimateId: string,
): Promise<string | null> {
  const estimate = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId } });
  if (estimate.depositCents <= 0 || estimate.depositPaidAt) return null;
  if (!estimate.customerId) {
    throw new Error("This estimate isn't linked to a customer yet — can't collect a deposit.");
  }

  const stripeCustomerId = await ensureStripeCustomer(estimate.customerId);
  const stripe = getStripeClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer: stripeCustomerId,
      payment_method_types: ["card", "us_bank_account"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: estimate.depositCents,
            product_data: {
              name: "Deposit",
              metadata: { kind: "DEPOSIT" },
            },
          },
        },
      ],
      success_url: `${appUrl}/estimate/${estimate.id}?deposit=success`,
      cancel_url: `${appUrl}/estimate/${estimate.id}?deposit=cancelled`,
      payment_intent_data: { setup_future_usage: "off_session" },
      metadata: { estimateId: estimate.id },
    },
    { idempotencyKey: `checkout-estimate-deposit-${estimate.id}` },
  );

  if (!session.url) {
    throw new Error("Stripe didn't return a Checkout URL for this estimate's deposit.");
  }
  return session.url;
}

const PAYMENT_METHOD_BLOCKER =
  "This customer hasn't completed checkout yet, so there's no saved payment method to bill — send them the checkout link again, or start billing manually once they have one on file.";
const RECONCILIATION_BLOCKER =
  "Stripe may have created this subscription, but the result is not confirmed locally. Reconcile Stripe before retrying billing.";

async function recordSubscriptionPreparationFailure(
  opId: string,
  agreementId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : "Stripe setup failed.";
  await prisma.$transaction(async (tx) => {
    await completeProviderOperation(tx, opId, { status: "FAILED", error });
    await tx.rentalAgreement.update({
      where: { id: agreementId },
      data: { billingBlockedReason: `Couldn't prepare recurring billing: ${message}` },
    });
  });
}

/**
 * Start recurring billing exactly once after delivery. The provider write is
 * claimed durably, performed outside any database transaction, then reconciled
 * back under a row lock. A conflicting local/provider subscription id is never
 * overwritten silently.
 */
export async function startRecurringBillingForAgreement(agreementId: string): Promise<void> {
  type Claimed =
    | { done: true }
    | {
        done: false;
        opId: string;
        idempotencyKey: string;
        agreement: {
          id: string;
          termMonths: number | null;
          endDate: Date | null;
          taxRateMilliPercent: number;
          customer: {
            stripeCustomerId: string;
            stripeDefaultPaymentMethodId: string;
          };
          plan: CheckoutLinePlan[];
        };
      };

  let claimed: Claimed;
  try {
    claimed = await prisma.$transaction(async (tx): Promise<Claimed> => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "RentalAgreement"
        WHERE "id" = ${agreementId}
        FOR UPDATE
      `;
      if (!locked[0]) throw new Error("Couldn't find that rental agreement.");

      const agreement = await tx.rentalAgreement.findUniqueOrThrow({
        where: { id: agreementId },
        include: {
          customer: {
            select: { stripeCustomerId: true, stripeDefaultPaymentMethodId: true },
          },
          lines: true,
        },
      });

      // A fixed term starts at delivery (owner decision IN-20): record its end
      // date the first time billing is attempted after delivery, under this
      // lock, and keep it on retries. Stripe's cancel_at below is derived from
      // this stored date, so a retry always sends the same stop date.
      let endDate = agreement.endDate;
      if (agreement.termMonths && !endDate) {
        endDate = fixedTermEndDate(
          agreement.billingStartedAt ?? new Date(),
          agreement.termMonths,
        );
        await tx.rentalAgreement.update({
          where: { id: agreementId },
          data: { endDate },
        });
      }

      if (agreement.paidInFullInAdvance) {
        if (agreement.billingBlockedReason) {
          await tx.rentalAgreement.update({
            where: { id: agreementId },
            data: { billingBlockedReason: null },
          });
        }
        return { done: true };
      }
      if (agreement.stripeSubscriptionId) return { done: true };

      const plan = buildCheckoutLinePlan(agreement).filter((item) => item.recurring);
      if (plan.length === 0) return { done: true };

      if (
        !agreement.customer.stripeCustomerId ||
        !agreement.customer.stripeDefaultPaymentMethodId
      ) {
        await tx.rentalAgreement.update({
          where: { id: agreementId },
          data: { billingBlockedReason: PAYMENT_METHOD_BLOCKER },
        });
        return { done: true };
      }

      const operation = await claimProviderOperation(tx, {
        kind: "SUBSCRIPTION_CREATE",
        subjectType: "RentalAgreement",
        subjectId: agreementId,
        idempotencyKey: `subscription-create-${agreementId}`,
      });

      if (operation.done) {
        await tx.rentalAgreement.update({
          where: { id: agreementId },
          data: {
            stripeSubscriptionId: operation.providerObjectId,
            billingStartedAt: agreement.billingStartedAt ?? new Date(),
            billingBlockedReason: null,
          },
        });
        return { done: true };
      }

      return {
        done: false,
        opId: operation.opId,
        idempotencyKey: operation.idempotencyKey,
        agreement: {
          id: agreement.id,
          termMonths: agreement.termMonths,
          endDate,
          taxRateMilliPercent: agreement.taxRateMilliPercent,
          customer: {
            stripeCustomerId: agreement.customer.stripeCustomerId,
            stripeDefaultPaymentMethodId:
              agreement.customer.stripeDefaultPaymentMethodId,
          },
          plan,
        },
      };
    });
  } catch (error) {
    const blocker =
      error instanceof RetryLater
        ? /unknown|drift|reconcil/i.test(error.message)
          ? RECONCILIATION_BLOCKER
          : "Recurring billing is already being started by another request. Try again after it finishes."
        : `Couldn't start recurring billing: ${error instanceof Error ? error.message : "Unexpected error."}`;
    await prisma.rentalAgreement.update({
      where: { id: agreementId },
      data: { billingBlockedReason: blocker },
    });
    return;
  }

  if (claimed.done) return;

  const stripe = getStripeClient();
  let taxRateId: string | null;
  let items;
  try {
    taxRateId = await getOrCreateTaxRate(claimed.agreement.taxRateMilliPercent);
    items = await Promise.all(
      claimed.agreement.plan.map(async (item) => {
        const product = await stripe.products.create(
          {
            name: item.description,
            metadata: {
              kind: item.kind,
              rentalLineId: item.rentalLineId ?? "",
              agreementId: claimed.agreement.id,
            },
          },
          { idempotencyKey: `product-${item.rentalLineId ?? claimed.agreement.id}` },
        );
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
  } catch (error) {
    // The Subscription itself was not attempted. Product creation is safe to
    // retry because every line has its own deterministic Stripe key.
    await recordSubscriptionPreparationFailure(claimed.opId, agreementId, error);
    return;
  }

  const cancelAt =
    claimed.agreement.termMonths && claimed.agreement.endDate
      ? Math.floor(
          businessDateEnd(businessDateKey(claimed.agreement.endDate)).getTime() / 1000,
        )
      : undefined;

  const providerResult = await runProviderCall(() =>
    stripe.subscriptions.create(
      {
        customer: claimed.agreement.customer.stripeCustomerId,
        default_payment_method:
          claimed.agreement.customer.stripeDefaultPaymentMethodId,
        items,
        metadata: { agreementId: claimed.agreement.id },
        ...(cancelAt ? { cancel_at: cancelAt } : {}),
      },
      { idempotencyKey: claimed.idempotencyKey },
    ),
  );

  if (!providerResult.ok) {
    await prisma.$transaction(async (tx) => {
      await completeProviderOperation(
        tx,
        claimed.opId,
        providerResult.outcome === "UNKNOWN"
          ? { status: "UNKNOWN", error: providerResult.error }
          : { status: "FAILED", error: providerResult.error },
      );
      await tx.rentalAgreement.update({
        where: { id: agreementId },
        data: {
          billingBlockedReason:
            providerResult.outcome === "UNKNOWN"
              ? RECONCILIATION_BLOCKER
              : `Couldn't start billing: ${providerResult.error instanceof Error ? providerResult.error.message : "Stripe rejected the subscription."}`,
        },
      });
    });
    return;
  }

  const stripeSubscriptionId = providerResult.value.id;
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      Array<{
        id: string;
        stripeSubscriptionId: string | null;
        billingStartedAt: Date | null;
      }>
    >`
      SELECT "id", "stripeSubscriptionId", "billingStartedAt"
      FROM "RentalAgreement"
      WHERE "id" = ${agreementId}
      FOR UPDATE
    `;
    const agreement = locked[0];
    if (!agreement) {
      await completeProviderOperation(tx, claimed.opId, {
        status: "DRIFT",
        providerObjectId: stripeSubscriptionId,
        note: `Stripe subscription ${stripeSubscriptionId} was created after local agreement ${agreementId} disappeared.`,
      });
      return;
    }

    if (!agreement.stripeSubscriptionId) {
      await tx.rentalAgreement.update({
        where: { id: agreementId },
        data: {
          stripeSubscriptionId,
          billingStartedAt: agreement.billingStartedAt ?? new Date(),
          billingBlockedReason: null,
        },
      });
      await completeProviderOperation(tx, claimed.opId, {
        status: "SUCCEEDED",
        providerObjectId: stripeSubscriptionId,
      });
      return;
    }

    if (agreement.stripeSubscriptionId === stripeSubscriptionId) {
      await tx.rentalAgreement.update({
        where: { id: agreementId },
        data: {
          billingStartedAt: agreement.billingStartedAt ?? new Date(),
          billingBlockedReason: null,
        },
      });
      await completeProviderOperation(tx, claimed.opId, {
        status: "SUCCEEDED",
        providerObjectId: stripeSubscriptionId,
      });
      return;
    }

    await completeProviderOperation(tx, claimed.opId, {
      status: "DRIFT",
      providerObjectId: stripeSubscriptionId,
      note: `Stripe returned ${stripeSubscriptionId}, but agreement ${agreementId} is already linked to ${agreement.stripeSubscriptionId}.`,
    });
    await tx.rentalAgreement.update({
      where: { id: agreementId },
      data: { billingBlockedReason: RECONCILIATION_BLOCKER },
    });
  });
}
