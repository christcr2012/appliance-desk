"use server";

import { revalidatePath } from "next/cache";
import { setAutomationPaused } from "@/domains/automation/health";
import { requireRole } from "@/lib/session";

export async function setAutomationPausedAction(formData: FormData): Promise<void> {
  const session = await requireRole("OWNER");
  const ruleKey = String(formData.get("ruleKey") ?? "");
  const paused = String(formData.get("paused") ?? "") === "true";
  await setAutomationPaused(session.user.id, ruleKey, paused);
  revalidatePath("/desk/automations");
}
