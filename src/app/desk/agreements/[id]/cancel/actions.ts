"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { approvePreDeliveryCancellation, type CancellationPolicy } from "@/domains/agreements/pre-delivery-cancellation";
import { getRentalEndReasons, parseEndReasonInput, recordAgreementEndReason } from "@/domains/agreements/end-reasons";

export type CancellationActionState = { error: string };
export async function approveCancellationAction(
  _previous: CancellationActionState,
  form: FormData,
): Promise<CancellationActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const agreementId = String(form.get("agreementId") ?? "");
  try {
    // AR-4a: validate the optional "Why is it ending?" answer BEFORE the
    // approval commits, so a stale reason can never surface as a failed
    // save after the cancellation already went through (PR #722 review).
    const rawReason = form.get("endReason");
    const endReasonInput = typeof rawReason === "string" && rawReason.trim()
      ? parseEndReasonInput(rawReason, typeof form.get("endReasonNote") === "string" ? (form.get("endReasonNote") as string) : null, await getRentalEndReasons())
      : null;
    await approvePreDeliveryCancellation({
      actorUserId: session.user.id,
      agreementId,
      expectedFingerprint: String(form.get("fingerprint") ?? ""),
      policy: String(form.get("policy") ?? "") as CancellationPolicy,
      reason: String(form.get("reason") ?? ""),
      reviewedTerms: form.get("reviewedTerms") === "on",
    });
    if (endReasonInput) {
      await recordAgreementEndReason(session.user.id, agreementId, endReasonInput);
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to cancel. Refresh the review." };
  }
  revalidatePath("/desk/today");
  revalidatePath("/desk/agreements/" + agreementId);
  revalidatePath("/desk/inventory");
  redirect("/desk/agreements/" + encodeURIComponent(agreementId));
}
