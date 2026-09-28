import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { getBusinessSettings } from "@/domains/settings";
import { sendEmail } from "@/lib/email";
import { formatCents } from "@/domains/pricing";
import { generateReferralCode, normalizeReferralCode } from "./code";

export { generateReferralCode, normalizeReferralCode } from "./code";

// ---------------------------------------------------------------------------
// Referral program (Task #68, docs/DECISIONS.md 2026-09-28 — Chris's
// pick: "discount for both people," i.e. give X/get X, one owner-
// adjustable amount, same for both sides). Three moments:
//
// 1. Every new customer gets a referralCode (generateUniqueReferralCode,
//    called from both src/domains/leads' convertLeadToCustomer and
//    src/domains/customers' createCustomerDirectly — the two places a
//    Customer row is ever created).
// 2. A lead who typed in someone's code gets linked to that referrer
//    the moment they convert to a customer (linkReferralIfCodeProvided,
//    called from convertLeadToCustomer). Just a link — PENDING, no
//    money moves yet.
// 3. The reward only fires once the REFERRED customer actually starts
//    paying — rewardReferralIfEligible, called from
//    src/domains/billing/checkout.ts's startRecurringBillingForAgreement
//    right after billingStartedAt is set. Rewarding on signup alone
//    would pay out for someone who never actually rents.
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

/** Keeps generating a random code until one isn't already taken — collisions
 * are astronomically rare at this alphabet/length, but checked for real
 * rather than assumed away. Takes a transaction client so it can run as
 * part of the same customer-creation transaction (never a separate,
 * non-atomic write). */
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

/**
 * Links a newly-converted customer to whoever referred them, if a valid
 * code was entered on the lead form. Silent no-op (never throws, never
 * blocks conversion) if the code is missing, doesn't match any customer,
 * or the visitor typed in their own future account's... well, that can't
 * happen at conversion time, but matching against the customer being
 * created right now is still guarded against, just in case. Called as
 * part of the same transaction that creates the Customer row.
 */
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

  // referredCustomerId is @unique on Referral — if this customer
  // somehow already has one (shouldn't happen; a customer is only
  // created once), this just leaves the existing link alone rather
  // than erroring the whole conversion.
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
 * Rewards both sides of a referral once the referred customer's
 * billing has actually started. No-op if this customer was never
 * referred, or their referral was already rewarded (checked by only
 * ever querying for a still-PENDING one, so calling this more than
 * once for the same customer — e.g. a second agreement starting
 * billing later — is safe).
 *
 * The reward is a real Stripe account-balance credit (a negative
 * balance automatically reduces that customer's next invoice) on
 * whichever side already has a Stripe customer on file; either side
 * that doesn't yet (never been billed) still gets its CustomerCredit
 * record — visible on their own customer page — for Chris to honor by
 * hand once they do. Best-effort throughout: a Stripe failure on one
 * side, or a failed confirmation email, never stops the other side
 * from being rewarded.
 */
export async function rewardReferralIfEligible(referredCustomerId: string): Promise<void> {
  const referral = await prisma.referral.findFirst({
    where: { referredCustomerId, status: "PENDING" },
    include: {
      referrerCustomer: {
        include: { user: { select: { name: true, email: true } } },
      },
      referredCustomer: {
        include: { user: { select: { name: true, email: true } } },
      },
    },
  });
  if (!referral) return;

  const settings = await getBusinessSettings();
  const rewardCents = settings.referralRewardCents;

  await Promise.all([
    grantOneReferralCredit({
      customerId: referral.referrerCustomer.id,
      stripeCustomerId: referral.referrerCustomer.stripeCustomerId,
      name: referral.referrerCustomer.user.name,
      email: referral.referrerCustomer.user.email,
      rewardCents,
      reason: `Referral reward — you referred ${referral.referredCustomer.user.name ?? referral.referredCustomer.user.email}`,
    }),
    grantOneReferralCredit({
      customerId: referral.referredCustomer.id,
      stripeCustomerId: referral.referredCustomer.stripeCustomerId,
      name: referral.referredCustomer.user.name,
      email: referral.referredCustomer.user.email,
      rewardCents,
      reason: "Referral reward — welcome credit for being referred",
    }),
  ]);

  await prisma.referral.update({
    where: { id: referral.id },
    data: { status: "REWARDED", rewardCents, rewardedAt: new Date() },
  });
}

async function grantOneReferralCredit(input: {
  customerId: string;
  stripeCustomerId: string | null;
  name: string | null;
  email: string;
  rewardCents: number;
  reason: string;
}): Promise<void> {
  let appliedViaStripe = false;

  if (input.stripeCustomerId) {
    try {
      const stripe = getStripeClient();
      // A negative balance is Stripe's own mechanism for "this customer
      // has a credit" — it's drawn down automatically against their
      // next invoice, no separate coupon or invoice-editing needed.
      await stripe.customers.createBalanceTransaction(input.stripeCustomerId, {
        amount: -input.rewardCents,
        currency: "usd",
        description: input.reason,
      });
      appliedViaStripe = true;
    } catch (error) {
      console.error("[referrals] Failed to apply Stripe balance credit", input.customerId, error);
    }
  }

  await prisma.customerCredit.create({
    data: {
      customerId: input.customerId,
      amountCents: input.rewardCents,
      remainingCents: input.rewardCents,
      reason: input.reason,
      notes: appliedViaStripe
        ? "Applied automatically as a Stripe account-balance credit — will reduce their next invoice."
        : "Not yet applied automatically (no Stripe account on file for this customer yet) — apply by hand once they're billed, or when they have one.",
    },
  });

  try {
    await sendEmail({
      to: input.email,
      subject: "You've got a referral credit",
      text: `Hi${input.name ? ` ${input.name}` : ""},\n\n${input.reason}. A ${formatCents(input.rewardCents)} credit has been added to your account${appliedViaStripe ? " and will automatically reduce your next payment" : ""}.\n\nThanks for being part of our referral program!`,
    });
  } catch (error) {
    console.error("[referrals] Failed to send referral credit email", input.customerId, error);
  }
}
