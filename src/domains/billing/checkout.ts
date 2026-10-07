import { prisma } from "@/lib/prisma";
import { cancelAtSecondsFor, subscriptionStartSecondsFor } from "./subscription-term";
import {
  applySubscriptionEnds,
  recomputeSubscriptionEndInTx,
} from "./subscription-end";
import { getStripeClient } from "@/lib/stripe";
import { fixedTermEndDate } from "@/lib/business-date";
import {
  assertTaxReadyForAgreement,
  taxRateVersionIdsForAgreement,
} from "@/domains/tax/locations";
import { ensureStripeTaxRate } from "@/domains/tax/stripe-rates";
import type { HandoffWorkOutcome } from "./handoff-outcome";
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
  const damageWaiverRateVersionIds = await prisma.$transaction(async (tx) => {
    await assertTaxReadyForAgreement(tx, agreement.id);
    if (!oneTimeItems.some((item) => item.kind === "DAMAGE_WAIVER")) return [];
    return taxRateVersionIdsForAgreement(tx, agreement.id, new Date(), "DAMAGE_WAIVER");
  });
  const damageWaiverTaxRateIds = await Promise.all(
    damageWaiverRateVersionIds.map((rateVersionId) => ensureStripeTaxRate(rateVersionId)),
  );
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
              tax_rates:
                item.kind === "DAMAGE_WAIVER" && damageWaiverTaxRateIds.length > 0
                  ? damageWaiverTaxRateIds
                  : undefined,
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
const DELIVERY_BLOCKER =
  "Recurring billing cannot start until at least one rental item has actually been delivered.";
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
 * Start recurring billing exactly once after the first real delivery. Provider
 * work runs outside transactions. The immutable firstDeliveredOn business date
 * is the authoritative local billing/term fact even when provider work is
 * retried later. Stripe is told the subscription started at Colorado midnight of that
 * day (owner decision IN-28), so a late set-up bills from the real delivery day, not
 * the day the set-up ran.
 */
export async function startRecurringBillingForAgreement(
  agreementId: string,
): Promise<HandoffWorkOutcome> {
  type Claimed =
    | { done: true; outcome: HandoffWorkOutcome; subscriptionEndIds: string[] }
    | {
        done: false;
        opId: string;
        idempotencyKey: string;
        agreement: {
          id: string;
          firstDeliveredOn: Date;
          termMonths: number | null;
          endDate: Date | null;
          taxRateVersionIds: string[];
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

      const firstDeliveredOn = agreement.firstDeliveredOn ?? agreement.billingStartedAt;
      if (!firstDeliveredOn) {
        await tx.rentalAgreement.update({
          where: { id: agreementId },
          data: { billingBlockedReason: DELIVERY_BLOCKER },
        });
        return { done: true, outcome: { state: "BLOCKED", detail: DELIVERY_BLOCKER }, subscriptionEndIds: [] };
      }

      let endDate = agreement.endDate;
      if (agreement.termMonths && !endDate) {
        endDate = fixedTermEndDate(firstDeliveredOn, agreement.termMonths);
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
        return { done: true, outcome: { state: "DONE" }, subscriptionEndIds: [] };
      }
      if (agreement.stripeSubscriptionId) {
        if (!agreement.billingStartedAt || agreement.billingBlockedReason) {
          await tx.rentalAgreement.update({
            where: { id: agreementId },
            data: {
              billingStartedAt: agreement.billingStartedAt ?? firstDeliveredOn,
              billingBlockedReason: null,
            },
          });
        }
        return { done: true, outcome: { state: "DONE" }, subscriptionEndIds: [] };
      }

      await assertTaxReadyForAgreement(tx, agreementId);
      const taxRateVersionIds = await taxRateVersionIdsForAgreement(
        tx,
        agreementId,
        firstDeliveredOn,
        "RENTAL",
      );
      const currentTaxRateVersionIds = await taxRateVersionIdsForAgreement(
        tx,
        agreementId,
        new Date(),
        "RENTAL",
      );
      if (
        taxRateVersionIds.length !== currentTaxRateVersionIds.length ||
        taxRateVersionIds.some(
          (rateVersionId, index) => rateVersionId !== currentTaxRateVersionIds[index],
        )
      ) {
        throw new Error(
          "A sales-tax rate changed after delivery. Automatic backdated billing is blocked so Stripe cannot apply the wrong rate to earlier rental periods.",
        );
      }

      const plan = buildCheckoutLinePlan(agreement).filter((item) => item.recurring);
      if (plan.length === 0) return { done: true, outcome: { state: "DONE" }, subscriptionEndIds: [] };

      if (
        !agreement.customer.stripeCustomerId ||
        !agreement.customer.stripeDefaultPaymentMethodId
      ) {
        await tx.rentalAgreement.update({
          where: { id: agreementId },
          data: { billingBlockedReason: PAYMENT_METHOD_BLOCKER },
        });
        return { done: true, outcome: { state: "BLOCKED", detail: PAYMENT_METHOD_BLOCKER }, subscriptionEndIds: [] };
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
            billingStartedAt: agreement.billingStartedAt ?? firstDeliveredOn,
            billingBlockedReason: null,
          },
        });
        await recomputeSubscriptionEndInTx(tx, operation.providerObjectId);
        return { done: true, outcome: { state: "DONE" }, subscriptionEndIds: [operation.providerObjectId] };
      }

      return {
        done: false,
        opId: operation.opId,
        idempotencyKey: operation.idempotencyKey,
        agreement: {
          id: agreement.id,
          firstDeliveredOn,
          termMonths: agreement.termMonths,
          endDate,
          taxRateVersionIds,
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
    const unknown = error instanceof RetryLater && /unknown|drift|reconcil/i.test(error.message);
    const detail =
      error instanceof RetryLater
        ? unknown
          ? RECONCILIATION_BLOCKER
          : "Recurring billing is already being started by another request. Try again after it finishes."
        : `Couldn't start recurring billing: ${error instanceof Error ? error.message : "Unexpected error."}`;
    await prisma.rentalAgreement
      .updateMany({
        where: { id: agreementId, stripeSubscriptionId: null },
        data: { billingBlockedReason: detail },
      })
      .catch(() => undefined);
    return { state: unknown ? "UNKNOWN" : "RETRY", detail };
  }

  if (claimed.done) {
    await applySubscriptionEnds(claimed.subscriptionEndIds);
    return claimed.outcome;
  }

  const stripe = getStripeClient();
  let items;
  try {
    const taxRateIds = await Promise.all(
      claimed.agreement.taxRateVersionIds.map((rateVersionId) =>
        ensureStripeTaxRate(rateVersionId),
      ),
    );
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
          tax_rates: taxRateIds.length > 0 ? taxRateIds : undefined,
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
    await recordSubscriptionPreparationFailure(claimed.opId, agreementId, error);
    return {
      state: "RETRY",
      detail: error instanceof Error ? error.message : "Stripe subscription preparation failed.",
    };
  }

  const cancelAt = cancelAtSecondsFor(claimed.agreement) ?? undefined;

  const providerResult = await runProviderCall(() =>
    stripe.subscriptions.create(
      {
        customer: claimed.agreement.customer.stripeCustomerId,
        default_payment_method:
          claimed.agreement.customer.stripeDefaultPaymentMethodId,
        items,
        metadata: {
          agreementId: claimed.agreement.id,
          firstDeliveredOn: claimed.agreement.firstDeliveredOn.toISOString(),
        },
        // Billing begins on the real delivery day (IN-28). Flexible mode bills each whole month from
        // that day (one line per month when set up late) and keeps the delivery-day cycle; it is named
        // here so a change in Stripe's account default can never change what customers are charged.
        billing_mode: { type: "flexible" },
        backdate_start_date: subscriptionStartSecondsFor(claimed.agreement.firstDeliveredOn),
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
    return {
      state: providerResult.outcome === "UNKNOWN" ? "UNKNOWN" : "RETRY",
      detail:
        providerResult.outcome === "UNKNOWN"
          ? RECONCILIATION_BLOCKER
          : providerResult.error instanceof Error
            ? providerResult.error.message
            : "Stripe rejected the subscription.",
    };
  }

  const stripeSubscriptionId = providerResult.value.id;
  const finalized = await prisma.$transaction(async (tx): Promise<{ outcome: HandoffWorkOutcome; subscriptionEndIds: string[] }> => {
    const locked = await tx.$queryRaw<
      Array<{
        id: string;
        stripeSubscriptionId: string | null;
        billingStartedAt: Date | null;
        firstDeliveredOn: Date | null;
      }>
    >`
      SELECT "id", "stripeSubscriptionId", "billingStartedAt", "firstDeliveredOn"
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
      return {
        outcome: { state: "UNKNOWN", detail: "Stripe created the subscription after the local agreement disappeared." },
        subscriptionEndIds: [],
      };
    }
    if (!agreement.firstDeliveredOn) {
      await completeProviderOperation(tx, claimed.opId, {
        status: "DRIFT",
        providerObjectId: stripeSubscriptionId,
        note: `Agreement ${agreementId} lost its first-delivery fact while Stripe subscription ${stripeSubscriptionId} was being created.`,
      });
      await tx.rentalAgreement.update({
        where: { id: agreementId },
        data: { billingBlockedReason: RECONCILIATION_BLOCKER },
      });
      return { outcome: { state: "UNKNOWN", detail: RECONCILIATION_BLOCKER }, subscriptionEndIds: [] };
    }

    if (!agreement.stripeSubscriptionId) {
      await tx.rentalAgreement.update({
        where: { id: agreementId },
        data: {
          stripeSubscriptionId,
          billingStartedAt: agreement.billingStartedAt ?? agreement.firstDeliveredOn,
          billingBlockedReason: null,
        },
      });
      await completeProviderOperation(tx, claimed.opId, {
        status: "SUCCEEDED",
        providerObjectId: stripeSubscriptionId,
      });
      await recomputeSubscriptionEndInTx(tx, stripeSubscriptionId);
      return { outcome: { state: "DONE" }, subscriptionEndIds: [stripeSubscriptionId] };
    }

    if (agreement.stripeSubscriptionId === stripeSubscriptionId) {
      await tx.rentalAgreement.update({
        where: { id: agreementId },
        data: {
          billingStartedAt: agreement.billingStartedAt ?? agreement.firstDeliveredOn,
          billingBlockedReason: null,
        },
      });
      await completeProviderOperation(tx, claimed.opId, {
        status: "SUCCEEDED",
        providerObjectId: stripeSubscriptionId,
      });
      await recomputeSubscriptionEndInTx(tx, stripeSubscriptionId);
      return { outcome: { state: "DONE" }, subscriptionEndIds: [stripeSubscriptionId] };
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
    return { outcome: { state: "UNKNOWN", detail: RECONCILIATION_BLOCKER }, subscriptionEndIds: [] };
  });
  await applySubscriptionEnds(finalized.subscriptionEndIds);
  return finalized.outcome;
}
