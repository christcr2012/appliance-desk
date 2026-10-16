"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { signAgreement } from "@/domains/agreements";
import { createCheckoutSessionForAgreement } from "@/domains/billing/checkout";
import { getReviewedSigningPayment } from "@/domains/billing/signing-payment-readiness";
import { startRenewalIfDue } from "@/domains/agreements/renewal-start";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";

const RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };

export type SignActionState =
  | { status: "idle" }
  | { status: "success"; agreementId: string; checkoutUrl: string | null;
      pendingSigningAmountCents?: number; paymentNeedsReview?: boolean }
  | { status: "error"; message: string };

const signSchema = z.object({
  deliverySelection:z.object({
    optionId:z.string().uuid(),expectedOfferVersion:z.number().int().min(1),
    questions:z.object({dryerOutlet:z.enum(["THREE_PRONG","FOUR_PRONG","GAS","UNKNOWN"]),
      washerHookups:z.enum(["YES","NO","UNKNOWN"]),stairs:z.boolean(),
      crewNotes:z.string().trim().max(1500)}),
  }).optional(),
  interfaceLanguage: z.enum(["en", "es"]).optional(),
  translationCopyDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  languagePreference: z.enum(["en", "es"]).optional(),
  signerName: z.string().trim().min(1, "Enter your full name.").max(200),
  signerEmail: z.string().trim().email("Enter a valid email address.").max(200),
  agreedToTerms: z
    .boolean()
    .refine((v) => v === true, "You must check the box confirming you've read and agree."),
});

export async function signAgreementAction(
  signatureRecordId: string,
  raw: Record<string, unknown>,
): Promise<SignActionState> {
  const parsed = signSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }
  const data = parsed.data;

  const headerList = await headers();
  const ipAddress =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    null;

  if (
    await isRateLimited(
      `sign-agreement:${ipAddress ?? "unknown"}`,
      RATE_LIMIT,
    )
  ) {
    return {
      status: "error",
      message:
        "Too many attempts from this connection recently — please wait a few minutes and try again.",
    };
  }

  try {
    const agreementId = await signAgreement(signatureRecordId, {
      // The actual signed legal text is English until separately approved.
      shownLanguage: "en",
      interfaceLanguage: data.interfaceLanguage ?? "en",
      translationCopyDigest: data.translationCopyDigest,
      languagePreference: data.languagePreference ?? "en",
      signerName: data.signerName,
      signerEmail: data.signerEmail,
      ipAddress,
      deliverySelection:data.deliverySelection,
    });

    let checkoutUrl: string | null = null;
    const signed = await prisma.rentalAgreement.findUnique({
      where: { id: agreementId },
      select: { renewedFromAgreementId: true,
        signingChargeSnapshot: { select: { id: true } },
        signature: { select: { signingOrderFingerprint: true, signingAllInCents: true } },
      },
    });
    if (signed?.renewedFromAgreementId) {
      // A renewal continues the rental the customer already pays for: no new
      // payment setup. If its start date has arrived it starts now; otherwise
      // the nightly job starts it on its start date.
      try {
        await startRenewalIfDue(agreementId);
      } catch (startError) {
        console.error(`Signed renewal ${agreementId} but couldn't start it yet:`, startError);
      }
      return { status: "success", agreementId, checkoutUrl };
    }
    // W-22: signing is not payment. Never attempt the legacy deposit/waiver
    // checkout for frozen fees, and never imply that an unavailable provider
    // checkout collected the amount the customer accepted.
    if (signed?.signingChargeSnapshot || signed?.signature?.signingOrderFingerprint ||
        signed?.signature?.signingAllInCents != null) {
      try {
        const reviewed = await getReviewedSigningPayment(agreementId);
        // W-24 TEST can continue directly to Stripe's hosted page only with
        // the independent signed-payment feature flag and sk_test key. The
        // existing checkout boundary enforces both and refuses LIVE.
        if (process.env.W22_SIGNING_TEST_CHECKOUT_ENABLED === "true" &&
            process.env.VERCEL_ENV !== "production" &&
            process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
          const { createSigningTestCheckout } =
            await import("@/domains/billing/signing-payment-checkout");
          const session = await createSigningTestCheckout(agreementId);
          return { status: "success", agreementId,
            checkoutUrl: session.checkoutUrl,
            pendingSigningAmountCents: reviewed.plan.allInCents,
            paymentNeedsReview: !session.checkoutUrl };
        }
        return { status: "success", agreementId, checkoutUrl: null,
          pendingSigningAmountCents: reviewed.plan.allInCents };
      } catch {
        // Signing already committed. An inconsistent payment proof must not
        // be downgraded to a success receipt or retried with legacy checkout.
        return { status: "success", agreementId, checkoutUrl: null,
          paymentNeedsReview: true };
      }
    }
    try {
      checkoutUrl = await createCheckoutSessionForAgreement(agreementId);
    } catch (checkoutError) {
      console.error(
        `Signed agreement ${agreementId} but couldn't create its Stripe Checkout session:`,
        checkoutError,
      );
    }

    return { status: "success", agreementId, checkoutUrl };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Couldn't sign this agreement.",
    };
  }
}
