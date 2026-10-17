"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  discardDraft,
  publishDraft,
  restoreRevisionToDraft,
  saveDraft,
  STALE_DRAFT_MESSAGE,
  STALE_LIVE_MESSAGE,
} from "@/domains/site-content";
import { SiteContentError } from "@/domains/site-content/types";

/**
 * V-C4 server actions for the Website screen. Every action re-checks that the signed-in user is an active owner or
 * admin (the domain checks it again inside its transaction), returns plain sentences, and never throws raw errors.
 */
export type WebsiteActionResult =
  | { status: "error"; message: string; stale?: boolean }
  | { status: "saved"; draftId: string; version: number }
  | { status: "published"; version: number; alreadyLive: boolean }
  | { status: "restored"; draftId: string; version: number; replacedDraft: boolean }
  | { status: "discarded" };

const SAFE_PREFIXES = [
  "Someone else changed this draft",
  "The live website changed",
  "That version was never published",
  "no longer has access",
  "could not be read",
  "not something you can change",
];

function failure(error: unknown, fallback: string): WebsiteActionResult {
  const text = error instanceof Error ? error.message : "";
  const stale = text === STALE_DRAFT_MESSAGE || text === STALE_LIVE_MESSAGE;
  if (error instanceof SiteContentError) return { status: "error", message: text };
  if (SAFE_PREFIXES.some((p) => text.startsWith(p) || text.includes(p))) return { status: "error", message: text, stale };
  // Field problems from the shared rules are written for the owner already ("… is too long", "… must start with https://").
  if (/ is too long| cannot be empty| must | not available| does not work| needs |choose |describe |promotion /i.test(text) && text.length < 300) {
    return { status: "error", message: text };
  }
  return { status: "error", message: fallback };
}

function refresh() {
  revalidatePath("/desk/settings/website");
  revalidatePath("/", "layout");
}

/** Save the owner's draft: the full set of items that differ from the recommended wording. Owners and admins only. */
export async function saveWebsiteValuesAction(input: {
  draftId?: string;
  expectedVersion?: number;
  values: Record<string, unknown>;
}): Promise<WebsiteActionResult> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    const saved = await saveDraft(session.user.id, { draftId: input.draftId, expectedVersion: input.expectedVersion, values: input.values });
    revalidatePath("/desk/settings/website");
    return { status: "saved", draftId: saved.draftId, version: saved.version };
  } catch (error) {
    return failure(error, "That could not be saved. Everything you typed is still on the screen; please try again.");
  }
}

/** Make the reviewed draft live. Needs the draft version and the live version the owner reviewed against. */
export async function publishWebsiteAction(input: {
  draftId: string;
  version: number;
  liveRevisionId: string | null;
}): Promise<WebsiteActionResult> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    const published = await publishDraft(session.user.id, input.draftId, input.version, input.liveRevisionId);
    refresh();
    return { status: "published", version: published.version, alreadyLive: published.alreadyLive === true };
  } catch (error) {
    return failure(error, "That could not be published, and nothing changed on the live website. Please try again.");
  }
}

/** Put an older published version into the draft for review. It does not go live. */
export async function restoreToDraftAction(input: {
  revisionId: string;
  draftId?: string;
  draftVersion?: number;
}): Promise<WebsiteActionResult> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    const restored = await restoreRevisionToDraft(session.user.id, input.revisionId, { draftId: input.draftId, draftVersion: input.draftVersion });
    revalidatePath("/desk/settings/website");
    return { status: "restored", draftId: restored.draftId, version: restored.version, replacedDraft: restored.replacedDraft };
  } catch (error) {
    return failure(error, "That version could not be put into the draft. Nothing changed.");
  }
}

/** Throw the open draft away. The live website is untouched. */
export async function discardDraftAction(input: { draftId: string; version: number }): Promise<WebsiteActionResult> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await discardDraft(session.user.id, input.draftId, input.version);
    revalidatePath("/desk/settings/website");
    return { status: "discarded" };
  } catch (error) {
    return failure(error, "The draft could not be discarded. Nothing changed.");
  }
}
