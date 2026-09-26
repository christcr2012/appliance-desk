"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { signAgreement } from "@/domains/agreements";

// Deliberately NOT behind requireRole — this is the customer's own
// signing action, and the customer portal doesn't exist yet (Phase 5).
// Access is gated by having the unguessable SignatureRecord link itself;
// see the note at the top of src/domains/agreements/index.ts.

export type SignActionState =
  | { status: "idle" }
  | { status: "success"; agreementId: string }
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

  try {
    const agreementId = await signAgreement(signatureRecordId, {
      signerName: data.signerName,
      signerEmail: data.signerEmail,
      ipAddress,
    });
    return { status: "success", agreementId };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Couldn't sign this agreement.",
    };
  }
}
