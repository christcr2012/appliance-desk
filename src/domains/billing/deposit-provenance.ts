import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";

import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { SUCCESSFUL_PAYMENT_STATUSES } from "./payment-status";

const ESTIMATE_SOURCE_ACTION = "estimate.deposit_source_receipt";
const MAX_LINEAGE_DEPTH = 100;
const MAX_STRIPE_PAGES = 50;

type DepositContextRow = {
  id: string;
  agreementId: string;
  sourceReceiptId: string | null;
  customerId: string;
};

type SourceReceipt = {
  id: string;
  customerId: string;
  source: "STRIPE" | "MANUAL";
  stripeChargeId: string | null;
};

type AgreementLineageRow = {
  id: string;
  customerId: string;
  sourceEstimateId: string | null;
  renewedFromAgreementId: string | null;
  stripeCustomerId: string | null;
};

type AgreementLineageLookup = {
  id: string;
  customerId: string;
  sourceEstimateId: string | null;
  renewedFromAgreementId: string | null;
  customer: { stripeCustomerId: string | null };
};

export type DepositRefundRail =
  | { kind: "STRIPE"; receiptId: string; stripeChargeId: string }
  | { kind: "MANUAL"; receiptId: string };

export class DepositProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepositProvenanceError";
  }
}

function reconciliationError(detail: string): DepositProvenanceError {
  return new DepositProvenanceError(
    `This deposit's original payment source needs reconciliation before it can be refunded. ${detail}`,
  );
}

function receiptIdFromAuditValue(value: Prisma.JsonValue | null): string | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const receiptId = (value as Prisma.JsonObject).receiptId;
  return typeof receiptId === "string" && receiptId.length > 0 ? receiptId : null;
}

async function loadDepositContext(depositId: string): Promise<DepositContextRow | null> {
  const rows = await prisma.$queryRaw<DepositContextRow[]>`
    SELECT
      d."id",
      d."agreementId",
      d."sourceReceiptId",
      a."customerId"
    FROM "Deposit" d
    JOIN "RentalAgreement" a ON a."id" = d."agreementId"
    WHERE d."id" = ${depositId}
  `;
  return rows[0] ?? null;
}

async function loadReceipt(receiptId: string): Promise<SourceReceipt | null> {
  return prisma.receipt.findUnique({
    where: { id: receiptId },
    select: {
      id: true,
      customerId: true,
      source: true,
      stripeChargeId: true,
    },
  });
}

async function loadAgreementLineage(
  agreementId: string,
  expectedCustomerId: string,
): Promise<AgreementLineageRow[]> {
  const newestToOldest: AgreementLineageRow[] = [];
  const seen = new Set<string>();
  let cursor: string | null = agreementId;

  while (cursor) {
    if (seen.has(cursor)) {
      throw reconciliationError("The agreement renewal chain contains a cycle.");
    }
    if (newestToOldest.length >= MAX_LINEAGE_DEPTH) {
      throw reconciliationError("The agreement renewal chain is unexpectedly deep.");
    }
    seen.add(cursor);

    const agreement: AgreementLineageLookup | null =
      await prisma.rentalAgreement.findUnique({
        where: { id: cursor },
        select: {
          id: true,
          customerId: true,
          sourceEstimateId: true,
          renewedFromAgreementId: true,
          customer: { select: { stripeCustomerId: true } },
        },
      });
    if (!agreement) {
      throw reconciliationError(`Agreement ${cursor} in the renewal chain no longer exists.`);
    }
    if (agreement.customerId !== expectedCustomerId) {
      throw reconciliationError("The renewal chain crosses customers, so the original payment cannot be inferred safely.");
    }

    newestToOldest.push({
      id: agreement.id,
      customerId: agreement.customerId,
      sourceEstimateId: agreement.sourceEstimateId,
      renewedFromAgreementId: agreement.renewedFromAgreementId,
      stripeCustomerId: agreement.customer.stripeCustomerId,
    });
    cursor = agreement.renewedFromAgreementId;
  }

  return newestToOldest.reverse();
}

async function findEarliestDepositReceiptForAgreement(
  agreementId: string,
): Promise<SourceReceipt | null> {
  const payment = await prisma.payment.findFirst({
    where: {
      status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] },
      receiptId: { not: null },
      invoice: {
        agreementId,
        lineItems: { some: { kind: "DEPOSIT" } },
      },
    },
    select: {
      receipt: {
        select: {
          id: true,
          customerId: true,
          source: true,
          stripeChargeId: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return payment?.receipt ?? null;
}

async function persistSourceReceipt(
  depositId: string,
  receipt: SourceReceipt,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<DepositContextRow[]>`
      SELECT
        d."id",
        d."agreementId",
        d."sourceReceiptId",
        a."customerId"
      FROM "Deposit" d
      JOIN "RentalAgreement" a ON a."id" = d."agreementId"
      WHERE d."id" = ${depositId}
      FOR UPDATE OF d
    `;
    const deposit = rows[0];
    if (!deposit) throw new Error("Deposit not found.");
    if (deposit.customerId !== receipt.customerId) {
      throw reconciliationError("The candidate source receipt belongs to a different customer.");
    }
    if (deposit.sourceReceiptId) {
      if (deposit.sourceReceiptId !== receipt.id) {
        throw reconciliationError("The deposit is already linked to a different source receipt.");
      }
      return;
    }

    const alreadyUsed = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Deposit"
      WHERE "sourceReceiptId" = ${receipt.id}
        AND "id" <> ${depositId}
      FOR UPDATE
    `;
    if (alreadyUsed.length > 0) {
      throw reconciliationError("The candidate source receipt is already linked to another deposit.");
    }

    await tx.$executeRaw`
      UPDATE "Deposit"
      SET "sourceReceiptId" = ${receipt.id}
      WHERE "id" = ${depositId}
        AND "sourceReceiptId" IS NULL
    `;
  });
}

async function resolveStripeChargeForReceipt(
  receipt: SourceReceipt,
): Promise<SourceReceipt> {
  if (receipt.source !== "STRIPE" || receipt.stripeChargeId) return receipt;

  const payment = await prisma.payment.findFirst({
    where: {
      receiptId: receipt.id,
      status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] },
      stripePaymentIntentId: { not: null },
    },
    select: { stripePaymentIntentId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!payment?.stripePaymentIntentId) return receipt;

  const stripe = getStripeClient();
  const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId, {
    expand: ["latest_charge"],
  });
  const latestCharge = intent.latest_charge;
  if (!latestCharge) return receipt;
  const stripeChargeId =
    typeof latestCharge === "string" ? latestCharge : latestCharge.id;

  await prisma.receipt.updateMany({
    where: { id: receipt.id, stripeChargeId: null },
    data: { stripeChargeId },
  });
  return { ...receipt, stripeChargeId };
}

async function railForReceipt(receipt: SourceReceipt): Promise<DepositRefundRail> {
  if (receipt.source === "MANUAL") {
    return { kind: "MANUAL", receiptId: receipt.id };
  }

  const resolved = await resolveStripeChargeForReceipt(receipt);
  if (!resolved.stripeChargeId) {
    throw reconciliationError(
      `Stripe receipt ${receipt.id} is missing the charge needed to return the money to the original payment method.`,
    );
  }
  return {
    kind: "STRIPE",
    receiptId: resolved.id,
    stripeChargeId: resolved.stripeChargeId,
  };
}

async function receiptFromEstimateAudit(
  estimateId: string,
  expectedCustomerId: string,
): Promise<SourceReceipt | null> {
  const mappings = await prisma.auditLog.findMany({
    where: {
      action: ESTIMATE_SOURCE_ACTION,
      entityType: "Estimate",
      entityId: estimateId,
    },
    select: { newValue: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const receiptIds = [
    ...new Set(
      mappings
        .map((mapping) => receiptIdFromAuditValue(mapping.newValue))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (receiptIds.length > 1) {
    throw reconciliationError(`Estimate ${estimateId} has conflicting deposit source receipts.`);
  }
  if (receiptIds.length === 0) return null;

  const receipt = await loadReceipt(receiptIds[0]!);
  if (!receipt) {
    throw reconciliationError(`Estimate ${estimateId} points to a receipt that no longer exists.`);
  }
  if (receipt.customerId !== expectedCustomerId) {
    throw reconciliationError(`Estimate ${estimateId} points to another customer's receipt.`);
  }
  return receipt;
}

async function receiptFromLegacyEstimateProvider(
  estimateId: string,
  expectedCustomerId: string,
  stripeCustomerId: string | null,
): Promise<SourceReceipt | null> {
  if (!stripeCustomerId) return null;

  const stripe = getStripeClient();
  let startingAfter: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_STRIPE_PAGES; pageNumber++) {
    const page = await stripe.checkout.sessions.list({
      customer: stripeCustomerId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const session = page.data.find(
      (candidate) =>
        candidate.metadata?.estimateId === estimateId &&
        candidate.payment_status === "paid" &&
        candidate.payment_intent,
    );
    if (session?.payment_intent) {
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent.id;
      const payment = await prisma.payment.findFirst({
        where: {
          stripePaymentIntentId: paymentIntentId,
          status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] },
          receiptId: { not: null },
        },
        select: {
          receipt: {
            select: {
              id: true,
              customerId: true,
              source: true,
              stripeChargeId: true,
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (payment?.receipt) {
        if (payment.receipt.customerId !== expectedCustomerId) {
          throw reconciliationError(`Estimate ${estimateId} resolved to another customer's receipt.`);
        }
        return payment.receipt;
      }

      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge"],
      });
      const latestCharge = intent.latest_charge;
      const chargeId = latestCharge
        ? typeof latestCharge === "string"
          ? latestCharge
          : latestCharge.id
        : null;
      if (!chargeId) {
        throw reconciliationError(`Estimate ${estimateId}'s paid Stripe PaymentIntent has no charge.`);
      }
      const receipt = await prisma.receipt.findUnique({
        where: { stripeChargeId: chargeId },
        select: {
          id: true,
          customerId: true,
          source: true,
          stripeChargeId: true,
        },
      });
      if (!receipt) {
        throw reconciliationError(
          `Stripe shows the paid estimate charge ${chargeId}, but no local receipt records it.`,
        );
      }
      if (receipt.customerId !== expectedCustomerId) {
        throw reconciliationError(`Estimate ${estimateId} resolved to another customer's receipt.`);
      }
      return receipt;
    }

    if (!page.has_more) return null;
    const last = page.data.at(-1);
    if (!last) return null;
    startingAfter = last.id;
  }

  throw reconciliationError(`Stripe session lookup for estimate ${estimateId} exceeded the safety page limit.`);
}

async function findEstimateSourceReceipt(
  estimateId: string,
  expectedCustomerId: string,
  stripeCustomerId: string | null,
): Promise<SourceReceipt | null> {
  return (
    (await receiptFromEstimateAudit(estimateId, expectedCustomerId)) ??
    (await receiptFromLegacyEstimateProvider(
      estimateId,
      expectedCustomerId,
      stripeCustomerId,
    ))
  );
}

export async function resolveDepositRefundRail(
  depositId: string,
): Promise<DepositRefundRail> {
  const deposit = await loadDepositContext(depositId);
  if (!deposit) throw new Error("Deposit not found.");

  if (deposit.sourceReceiptId) {
    const receipt = await loadReceipt(deposit.sourceReceiptId);
    if (!receipt) {
      throw reconciliationError("Its linked source receipt no longer exists.");
    }
    if (receipt.customerId !== deposit.customerId) {
      throw reconciliationError("Its linked source receipt belongs to a different customer.");
    }
    return railForReceipt(receipt);
  }

  const lineage = await loadAgreementLineage(
    deposit.agreementId,
    deposit.customerId,
  );
  for (const agreement of lineage) {
    const receipt = await findEarliestDepositReceiptForAgreement(agreement.id);
    if (!receipt) continue;
    if (receipt.customerId !== deposit.customerId) {
      throw reconciliationError("A legacy deposit payment in the renewal chain belongs to a different customer.");
    }
    await persistSourceReceipt(deposit.id, receipt);
    return railForReceipt(receipt);
  }

  const estimateAgreement = lineage.find((agreement) => agreement.sourceEstimateId);
  if (estimateAgreement?.sourceEstimateId) {
    const receipt = await findEstimateSourceReceipt(
      estimateAgreement.sourceEstimateId,
      deposit.customerId,
      estimateAgreement.stripeCustomerId,
    );
    if (receipt) {
      await persistSourceReceipt(deposit.id, receipt);
      return railForReceipt(receipt);
    }
  }

  throw reconciliationError(
    "No durable receipt proves whether the money came from Stripe or was returned manually. No refund was attempted.",
  );
}

async function paymentReceiptForPaymentIntent(
  paymentIntentId: string,
): Promise<SourceReceipt | null> {
  const payment = await prisma.payment.findFirst({
    where: {
      stripePaymentIntentId: paymentIntentId,
      status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] },
      receiptId: { not: null },
      invoice: { lineItems: { some: { kind: "DEPOSIT" } } },
    },
    select: {
      receipt: {
        select: {
          id: true,
          customerId: true,
          source: true,
          stripeChargeId: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return payment?.receipt ?? null;
}

async function rememberEstimateSourceReceipt(
  estimateId: string,
  receipt: SourceReceipt,
  paymentIntentId: string,
): Promise<void> {
  const estimate = await prisma.estimate.findUnique({
    where: { id: estimateId },
    select: { customerId: true },
  });
  if (!estimate?.customerId) {
    throw reconciliationError(`Estimate ${estimateId} is not linked to a customer.`);
  }
  if (estimate.customerId !== receipt.customerId) {
    throw reconciliationError(`Estimate ${estimateId}'s deposit receipt belongs to another customer.`);
  }

  const existing = await receiptFromEstimateAudit(estimateId, estimate.customerId);
  if (existing) {
    if (existing.id !== receipt.id) {
      throw reconciliationError(`Estimate ${estimateId} already has a different deposit source receipt.`);
    }
    return;
  }

  await prisma.auditLog.create({
    data: {
      userId: null,
      action: ESTIMATE_SOURCE_ACTION,
      entityType: "Estimate",
      entityId: estimateId,
      newValue: { receiptId: receipt.id, paymentIntentId },
    },
  });
}

async function depositIdForAgreement(agreementId: string): Promise<string | null> {
  const deposit = await prisma.deposit.findFirst({
    where: { agreementId },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return deposit?.id ?? null;
}

async function captureCheckoutDeposit(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode !== "payment" || session.payment_status !== "paid") return;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!paymentIntentId) return;

  const receipt = await paymentReceiptForPaymentIntent(paymentIntentId);
  if (!receipt) {
    if (session.metadata?.estimateId) {
      throw reconciliationError(
        `Paid estimate session ${session.id} has no successful local deposit payment/receipt yet.`,
      );
    }
    return;
  }

  const estimateId = session.metadata?.estimateId;
  if (estimateId) {
    await rememberEstimateSourceReceipt(estimateId, receipt, paymentIntentId);
    return;
  }

  const agreementId = session.metadata?.agreementId;
  if (!agreementId) return;
  const depositId = await depositIdForAgreement(agreementId);
  if (!depositId) {
    throw reconciliationError(
      `Paid agreement session ${session.id} recorded a deposit payment but no Deposit row exists.`,
    );
  }
  await persistSourceReceipt(depositId, receipt);
}

async function capturePaidSubscriptionInvoice(
  stripeInvoice: Stripe.Invoice,
): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: {
      status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] },
      receiptId: { not: null },
      invoice: {
        stripeInvoiceId: stripeInvoice.id,
        agreementId: { not: null },
        lineItems: { some: { kind: "DEPOSIT" } },
      },
    },
    select: {
      invoice: { select: { agreementId: true } },
      receipt: {
        select: {
          id: true,
          customerId: true,
          source: true,
          stripeChargeId: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!payment?.receipt || !payment.invoice.agreementId) return;
  const depositId = await depositIdForAgreement(payment.invoice.agreementId);
  if (!depositId) {
    throw reconciliationError(
      `Paid Stripe invoice ${stripeInvoice.id} contains a deposit but no Deposit row exists.`,
    );
  }
  await persistSourceReceipt(depositId, payment.receipt);
}

/**
 * Runs after the existing webhook transaction commits. A thrown error makes
 * Stripe retry the webhook; the existing WebhookEvent idempotency guard makes
 * the business mutation a no-op while this provenance handoff retries safely.
 */
export async function captureDepositProvenanceFromWebhook(
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await captureCheckoutDeposit(event.data.object as Stripe.Checkout.Session);
      return;
    case "invoice.paid":
      await capturePaidSubscriptionInvoice(event.data.object as Stripe.Invoice);
      return;
    default:
      return;
  }
}

/**
 * The legacy estimate conversion commits atomically before this runs. If this
 * handoff is interrupted, retrying conversion returns the existing agreement
 * IDs and calls this function again, so a crash cannot permanently lose the
 * immutable receipt link.
 */
export async function attachEstimateDepositSourceAfterConversion(
  estimateId: string,
  agreementIds: string[],
): Promise<void> {
  if (agreementIds.length !== 1) return;
  const depositId = await depositIdForAgreement(agreementIds[0]!);
  if (!depositId) return;

  const context = await loadDepositContext(depositId);
  if (!context || context.sourceReceiptId) return;

  const estimate = await prisma.estimate.findUnique({
    where: { id: estimateId },
    select: {
      customerId: true,
      customer: { select: { stripeCustomerId: true } },
      depositPaidAt: true,
      depositCents: true,
    },
  });
  if (!estimate?.customerId || !estimate.depositPaidAt || estimate.depositCents <= 0) {
    return;
  }

  const receipt = await findEstimateSourceReceipt(
    estimateId,
    estimate.customerId,
    estimate.customer?.stripeCustomerId ?? null,
  );
  if (!receipt) {
    throw reconciliationError(
      `Estimate ${estimateId} was converted with a prepaid deposit, but its funding receipt could not be recovered.`,
    );
  }
  await persistSourceReceipt(depositId, receipt);
}
