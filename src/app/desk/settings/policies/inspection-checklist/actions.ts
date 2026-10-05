"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { publishChecklistVersion } from "@/domains/inventory/checklist-versions";

export type ChecklistActionState = { status: "success"; version: number } | { status: "error"; message: string };

export async function publishChecklistAction(input: { items: string[]; expectedCurrentVersion: number }): Promise<ChecklistActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    const result = await publishChecklistVersion(session.user.id, input.items, { expectedCurrentVersion: input.expectedCurrentVersion });
    revalidatePath("/desk/settings/policies/inspection-checklist");
    return { status: "success", version: result.version };
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    const known = ["Each item", "at least one", "at most", "must be text", "could not be read", "same checklist", "Someone published", "no longer has access"];
    return { status: "error", message: known.some((k) => text.includes(k)) ? text : "That could not be published. Please try again." };
  }
}
