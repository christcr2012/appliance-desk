"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { recordSpanishReview } from "@/domains/language/review";

export type SpanishReviewActionState = { status: "idle" | "success" | "error"; message: string };
export async function saveSpanishReviewAction(
  _old: SpanishReviewActionState, form: FormData,
): Promise<SpanishReviewActionState> {
  const owner = await requireRole("OWNER");
  const kind = form.get("action");
  if (kind !== "FLUENT" && kind !== "LEGAL" &&
      kind !== "PUBLISH" && kind !== "DISABLE")
    return { status: "error", message: "Invalid review action." };
  try {
    await recordSpanishReview(owner.user.id, kind, {
      expectedDigest: String(form.get("expectedDigest") ?? ""),
      reviewer: String(form.get("reviewer") ?? ""),
      reference: String(form.get("reference") ?? ""),
    });
    revalidatePath("/desk/settings");
    revalidatePath("/account", "layout");
    return { status: "success", message: "Review record updated. No provider action was performed." };
  } catch (error) {
    return { status: "error",
      message: error instanceof Error ? error.message : "Could not update the review." };
  }
}
