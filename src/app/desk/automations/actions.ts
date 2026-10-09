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

import { addOwnerSystemIssueNote, markSystemIssueResolved } from "@/domains/system-issues/queries";

export async function addSystemIssueNoteAction(formData: FormData): Promise<void> {
  const session = await requireRole("OWNER");
  await addOwnerSystemIssueNote(session.user.id, {
    issueId: String(formData.get("issueId") ?? ""),
    body: String(formData.get("body") ?? ""),
    expectedVersion: Number(formData.get("version")),
  });
  revalidatePath("/desk/automations");
  revalidatePath("/desk/today");
}

export async function markSystemIssueResolvedAction(formData: FormData): Promise<void> {
  const session = await requireRole("OWNER");
  await markSystemIssueResolved(session.user.id, {
    issueId: String(formData.get("issueId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    expectedVersion: Number(formData.get("version")),
  });
  revalidatePath("/desk/automations");
  revalidatePath("/desk/today");
}
