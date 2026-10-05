"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { publishDraft, restoreRevision, saveDraft } from "@/domains/site-content";

export type WebsiteActionState =
  | { status: "error"; message: string }
  | { status: "saved"; draftId: string; version: number }
  | { status: "done" };

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  // Our own plain-English messages are safe to show; anything else is not.
  const known = [
    "Someone else changed this draft",
    "is too long",
    "must start with https://",
    "must be on one line",
    "must be text",
    "not something you can change",
    "never published",
    "no longer has access",
    "could not be read",
  ];
  return known.some((k) => text.includes(k)) ? text : "That could not be saved. Your changes are still on the screen; please try again.";
}

function refresh() {
  revalidatePath("/desk/settings/website");
  revalidatePath("/", "layout");
}

/** Save the owner's draft of the website text. Owners and admins only. */
export async function saveWebsiteDraftAction(input: {
  draftId?: string;
  expectedVersion?: number;
  fields: Record<string, string>;
  note?: string;
}): Promise<WebsiteActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    const saved = await saveDraft(session.user.id, input);
    revalidatePath("/desk/settings/website");
    return { status: "saved", draftId: saved.draftId, version: saved.version };
  } catch (error) {
    return { status: "error", message: messageOf(error) };
  }
}

/** Make the saved draft the live website text. */
export async function publishWebsiteDraftAction(draftId: string, expectedVersion: number): Promise<WebsiteActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await publishDraft(session.user.id, draftId, expectedVersion);
  } catch (error) {
    return { status: "error", message: messageOf(error) };
  }
  refresh();
  return { status: "done" };
}

/** Put an older version of the website text live again (as a new version). */
export async function restoreWebsiteVersionAction(revisionId: string): Promise<WebsiteActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await restoreRevision(session.user.id, revisionId);
  } catch (error) {
    return { status: "error", message: messageOf(error) };
  }
  refresh();
  return { status: "done" };
}
