"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { signAgreement } from "@/domains/agreements";
import { createCheckoutSessionForAgreement } from "@/domains/billing/checkout";
import { startRenewalIfDue } from "@/domains/agreements/renewal-start";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";

const RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };

export type SignActionState =
  | { status: "idle" }
  | { status: "success"; agreementId: string; checkoutUrl: string | null }
  | { status: "error"; message: string };

const signSchema = z.object({
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
      signerName: data.signerName,
      signerEmail: data.signerEmail,
      ipAddress,
    });

    let checkoutUrl: string | null = null;
    const signed = await prisma.rentalAgreement.findUnique({
      where: { id: agreementId },
      select: { renewedFromAgreementId: true },
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
