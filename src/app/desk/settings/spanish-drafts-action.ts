"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { saveTranslationDraft } from "@/domains/language/drafts";

export type SpanishDraftState = { status: "idle" | "success" | "error"; message: string };
export async function saveSpanishDraftAction(
  _previous: SpanishDraftState, form: FormData,
): Promise<SpanishDraftState> {
  const actor = await requireRole("OWNER", "ADMIN");
  const kind = form.get("kind");
  if (kind !== "SITE" && kind !== "COMMUNICATION" && kind !== "MESSAGE" && kind !== "LEGAL" && kind !== "NOTICE" && kind !== "QUOTE")
    return { status: "error", message: "Invalid translation category." };
  const version = String(form.get("revision") ?? "");
  const expectedRevision = version === "" ? null : Number(version);
  try {
    await saveTranslationDraft(
      actor.user.id, kind, String(form.get("key") ?? ""),
      String(form.get("digest") ?? ""), expectedRevision,
      String(form.get("spanish") ?? ""),
    );
    revalidatePath("/desk/settings");
    return { status: "success", message: "Spanish draft saved. Still unpublished pending review." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Could not save translation." };
  }
}
