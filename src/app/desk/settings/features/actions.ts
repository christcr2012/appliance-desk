"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { setFeatureShown } from "@/domains/features/write";
import { isFeatureKey } from "@/domains/features/registry";

export async function setFeatureShownAction(data: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("OWNER");
  const key = data.get("feature");
  const checked = data.get("checked");
  if (typeof key !== "string" || !isFeatureKey(key) || (checked !== "true" && checked !== "false"))
    return { ok: false, error: "That feature choice is not valid." };
  try {
    await setFeatureShown(session.user.id, key, checked === "true");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save that choice." };
  }
  revalidatePath("/desk", "layout");
  revalidatePath("/desk/settings/features");
  return { ok: true };
}
