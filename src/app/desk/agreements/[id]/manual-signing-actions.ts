"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { prepareSigningPaymentAttempt } from "@/domains/billing/signing-payment-attempts";
import { recordManualSigningPayment } from "@/domains/billing/signing-payment-manual";
import type { ManualPaymentMethod } from "@/domains/billing/manual-payments";

export type ManualSigningFormState = { message: string; success: boolean };
export async function recordManualSigningAction(
  agreementId: string,
  _previous: ManualSigningFormState,
  formData: FormData,
): Promise<ManualSigningFormState> {
  // Role is enforced here as well as in the page and transaction.
  const session = await requireRole("OWNER", "ADMIN");
  const method = String(formData.get("method") ?? "");
  const reference = String(formData.get("reference") ?? "");
  const receivedOn = String(formData.get("receivedOn") ?? "");
  const confirmedReceived = formData.get("confirmedReceived") === "yes";
  if (!confirmedReceived) {
    return { success: false, message: "Confirm that the signed amount was actually received." };
  }
  if (!["cash", "check", "bank_transfer", "other"].includes(method) ||
      !reference.trim() || reference.length > 120 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) {
    return { success: false, message: "Choose a valid method, date and reference." };
  }
  try {
    const attempt = await prepareSigningPaymentAttempt(agreementId, "MANUAL", session.user.id);
    const result = await recordManualSigningPayment({
      agreementId, attemptId: attempt.id, actingUserId: session.user.id,
      method: method as ManualPaymentMethod, reference, receivedOn, confirmedReceived,
    });
    revalidatePath("/desk/agreements/" + agreementId);
    return { success: true,
      message: result.replayed ? "Previously recorded payment verified. No second receipt created." :
        "Signed payment recorded once. Receipt: " + result.receiptId };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message :
      "Payment was not recorded. Review the existing signing attempt." };
  }
}
