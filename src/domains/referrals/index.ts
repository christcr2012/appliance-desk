import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { formatCents } from "@/domains/pricing";
import {
  claimProviderOperation,
  completeProviderOperation,
  RetryLater,
  runProviderCall,
} from "@/domains/billing/provider-ops";
import { generateReferralCode, normalizeReferralCode } from "./code";

export { generateReferralCode, normalizeReferralCode } from "./code";

type Tx = Prisma.TransactionClient;
type ReferralSide = "referrer" | "referred";

/** Keeps generating a random code until one isn't already taken. */
export async function generateUniqueReferralCode(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateReferralCode();
    const existing = await tx.customer.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new Error(
    "Could not generate a unique referral code after 10 attempts — this should never happen at this alphabet size.",
  );
}

/** Link a converted customer to the referrer whose code they supplied. */
export async function linkReferralIfCodeProvided(
  tx: Tx,
  referredCustomerId: string,
  rawCode: string | null,
): Promise<void> {
  if (!rawCode) return;
  const code = normalizeReferralCode(rawCode);
  if (!code) return;

  const referrer = await tx.customer.findUnique({
    where: { referralCode: code },
    select: { id: true },
  });
  if (!referrer || referrer.id === referredCustomerId) return;

  const alreadyLinked = await tx.referral.findUnique({
    where: { referredCustomerId },
    select: { id: true },
  });
  if (alreadyLinked) return;

  await tx.referral.create({
    data: { referrerCustomerId: referrer.id, referredCustomerId },
  });
}

/**
 * Claim a referral reward only after the referred customer's invoice is truly
 * PAID. The Referral row is locked first, and both local CustomerCredit rows
 * are minted in the same transaction as PENDING -> REWARDING. That makes the
 * local reward exactly-once even when Stripe delivers duplicate paid events.
 *
 * Provider writes happen later, after the webhook transaction commits.
 */
export async function rewardReferralOnFirstPaidInvoice(
  tx: Tx,
  referredCustomerId: string,
): Promise<{ creditIds: string[] } | null> {
  const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT "id", "status"
    FROM "Referral"
    WHERE "referredCustomerId" = ${referredCustomerId}
    FOR UPDATE
  `;
  const claimed = locked[0];
  if (!claimed || claimed.status !== "PENDING") return null;

  const referral = await tx.referral.findUniqueOrThrow({
    where: { id: claimed.id },
    include: {
      referrerCustomer: {
        include: { user: { select: { name: true, email: true } } },
      },
      referredCustomer: {
        include: { user: { select: { name: true, email: true } } },
      },
    },
  });
  const settings = await tx.businessSettings.findUniqueOrThrow({
    where: { id: "singleton" },
    select: { referralRewardCents: true },
  });
  const rewardCents = settings.referralRewardCents;

  const referrerCredit = await tx.customerCredit.create({
    data: {
      customerId: referral.referrerCustomerId,
      amountCents: rewardCents,
      remainingCents: rewardCents,
      reason: `Referral reward — you referred ${referral.referredCustomer.user.name ?? referral.referredCustomer.user.email}`,
      notes: "Referral reward recorded locally; provider settlement follows after the paid-invoice transaction commits.",
      sourceType: "REFERRAL",
      sourceId: referral.id,
      side: "referrer",
    },
    select: { id: true },
  });
  const referredCredit = await tx.customerCredit.create({
    data: {
      customerId: referral.referredCustomerId,
      amountCents: rewardCents,
      remainingCents: rewardCents,
      reason: "Referral reward — welcome credit for being referred",
      notes: "Referral reward recorded locally; provider settlement follows after the paid-invoice transaction commits.",
      sourceType: "REFERRAL",
      sourceId: referral.id,
      side: "referred",
    },
    select: { id: true },
  });

  await tx.referral.update({
    where: { id: referral.id },
    data: { status: "REWARDING", rewardCents },
  });

  return { creditIds: [referrerCredit.id, referredCredit.id] };
}

async function markCreditAppliedViaStripe(
  creditId: string,
  providerObjectId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; appliedViaStripeAt: Date | null }>>`
      SELECT "id", "appliedViaStripeAt"
      FROM "CustomerCredit"
      WHERE "id" = ${creditId}
      FOR UPDATE
    `;
    const credit = locked[0];
    if (!credit) throw new Error(`Referral credit ${creditId} no longer exists.`);
    if (credit.appliedViaStripeAt) return;

    await tx.customerCredit.update({
      where: { id: creditId },
      data: {
        appliedViaStripeAt: new Date(),
        remainingCents: 0,
        notes: `Applied automatically as Stripe account-balance credit ${providerObjectId}.`,
      },
    });
  });
}

async function settleOneReferralCredit(input: {
  referralId: string;
  creditId: string;
  side: ReferralSide;
}): Promise<void> {
  const latest = await prisma.customerCredit.findUniqueOrThrow({
    where: { id: input.creditId },
    include: { customer: { select: { stripeCustomerId: true } } },
  });
  if (latest.appliedViaStripeAt || !latest.customer.stripeCustomerId) return;

  let claim:
    | { done: true; providerObjectId: string }
    | { done: false; opId: string; idempotencyKey: string };
  try {
    claim = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; appliedViaStripeAt: Date | null }>>`
        SELECT "id", "appliedViaStripeAt"
        FROM "CustomerCredit"
        WHERE "id" = ${input.creditId}
        FOR UPDATE
      `;
      const credit = locked[0];
      if (!credit) throw new Error(`Referral credit ${input.creditId} no longer exists.`);
      if (credit.appliedViaStripeAt) {
        return { done: true as const, providerObjectId: "already-applied" };
      }

      return claimProviderOperation(tx, {
        kind: "BALANCE_CREDIT",
        subjectType: "CustomerCredit",
        subjectId: input.creditId,
        idempotencyKey: `referral-credit-${input.referralId}-${input.side}`,
      });
    });
  } catch (error) {
    if (error instanceof RetryLater) return;
    throw error;
  }

  if (claim.done) {
    if (claim.providerObjectId !== "already-applied") {
      await markCreditAppliedViaStripe(input.creditId, claim.providerObjectId);
    }
    return;
  }

  const stripe = getStripeClient();
  const result = await runProviderCall(() =>
    stripe.customers.createBalanceTransaction(
      latest.customer.stripeCustomerId!,
      {
        amount: -latest.amountCents,
        currency: "usd",
        description: latest.reason,
        metadata: {
          creditId: input.creditId,
          referralId: input.referralId,
          side: input.side,
        },
      },
      { idempotencyKey: claim.idempotencyKey },
    ),
  );

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id"
      FROM "CustomerCredit"
      WHERE "id" = ${input.creditId}
      FOR UPDATE
    `;

    if (result.ok) {
      await tx.customerCredit.update({
        where: { id: input.creditId },
        data: {
          appliedViaStripeAt: new Date(),
          remainingCents: 0,
          notes: `Applied automatically as Stripe account-balance credit ${result.value.id}.`,
        },
      });
      await completeProviderOperation(tx, claim.opId, {
        status: "SUCCEEDED",
        providerObjectId: result.value.id,
      });
      return;
    }

    await completeProviderOperation(tx, claim.opId, {
      status: result.outcome,
      error: result.error,
    });
  });
}

async function sendReferralRewardNotice(input: {
  referralId: string;
  side: ReferralSide;
  customerId: string;
  name: string | null;
  email: string;
  rewardCents: number;
  reason: string;
  appliedViaStripe: boolean;
}): Promise<void> {
  const result = await sendEmail({
    to: input.email,
    subject: "You've got a referral credit",
    text: `Hi${input.name ? ` ${input.name}` : ""},\n\n${input.reason}. A ${formatCents(input.rewardCents)} credit has been added to your account${input.appliedViaStripe ? " and will automatically reduce your next payment" : ""}.\n\nThanks for being part of our referral program!`,
    idempotencyKey: `referral-reward-email-${input.referralId}-${input.side}`,
  });
  if (!result.sent) {
    console.error("[referrals] Referral credit email was not accepted", input.customerId);
  }
}

async function finishReferralIfSettled(referralId: string): Promise<void> {
  const credits = await prisma.customerCredit.findMany({
    where: { sourceType: "REFERRAL", sourceId: referralId },
    include: {
      customer: {
        select: {
          id: true,
          stripeCustomerId: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (credits.length !== 2) {
    throw new Error(`Referral ${referralId} does not have exactly two local reward credits.`);
  }

  const allSettled = credits.every(
    (credit) => credit.appliedViaStripeAt !== null || credit.customer.stripeCustomerId === null,
  );
  if (!allSettled) return;

  const marked = await prisma.referral.updateMany({
    where: { id: referralId, status: "REWARDING" },
    data: { status: "REWARDED", rewardedAt: new Date() },
  });
  if (marked.count !== 1) return;

  for (const credit of credits) {
    if (credit.side !== "referrer" && credit.side !== "referred") continue;
    await sendReferralRewardNotice({
      referralId,
      side: credit.side,
      customerId: credit.customer.id,
      name: credit.customer.user.name,
      email: credit.customer.user.email,
      rewardCents: credit.amountCents,
      reason: credit.reason,
      appliedViaStripe: credit.appliedViaStripeAt !== null,
    });
  }
}

/**
 * Deliver a claimed referral's two local credits to Stripe where possible.
 * Local credits are the source of truth; a side with no Stripe customer keeps
 * its credit local. Provider failures leave the referral REWARDING so the
 * reconciliation pass can retry without minting another local credit.
 */
export async function settleReferralCredits(referralId: string): Promise<void> {
  const referral = await prisma.referral.findUnique({
    where: { id: referralId },
    select: { status: true },
  });
  if (!referral || referral.status === "PENDING" || referral.status === "REWARDED") return;

  const credits = await prisma.customerCredit.findMany({
    where: { sourceType: "REFERRAL", sourceId: referralId },
    select: { id: true, side: true },
  });
  if (credits.length !== 2) {
    throw new Error(`Referral ${referralId} does not have exactly two local reward credits.`);
  }

  for (const credit of credits) {
    if (credit.side !== "referrer" && credit.side !== "referred") {
      throw new Error(`Referral credit ${credit.id} has an invalid side.`);
    }
    await settleOneReferralCredit({
      referralId,
      creditId: credit.id,
      side: credit.side,
    });
  }

  await finishReferralIfSettled(referralId);
}
