"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { approvePreDeliveryCancellation, type CancellationPolicy } from "@/domains/agreements/pre-delivery-cancellation";

export type CancellationActionState = { error: string };
export async function approveCancellationAction(
  _previous: CancellationActionState,
  form: FormData,
): Promise<CancellationActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const agreementId = String(form.get("agreementId") ?? "");
  try {
    await approvePreDeliveryCancellation({
      actorUserId: session.user.id,
      agreementId,
      expectedFingerprint: String(form.get("fingerprint") ?? ""),
      policy: String(form.get("policy") ?? "") as CancellationPolicy,
      reason: String(form.get("reason") ?? ""),
      reviewedTerms: form.get("reviewedTerms") === "on",
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to cancel. Refresh the review." };
  }
  revalidatePath("/desk/today");
  revalidatePath("/desk/agreements/" + agreementId);
  revalidatePath("/desk/inventory");
  redirect("/desk/agreements/" + encodeURIComponent(agreementId));
}
