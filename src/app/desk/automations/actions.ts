"use server";

import { revalidatePath } from "next/cache";
import { RECOMMENDED_LATE_GRACE_MINUTES, saveLateGraceMinutes, setAutomationPaused } from "@/domains/automation/health";
import { requireRole } from "@/lib/session";

/** MCP-1: owner-only "late" grace period (minutes after a job's usual time). */
export async function saveLateGraceAction(formData: FormData): Promise<void> {
  const session = await requireRole("OWNER");
  const restore = formData.get("operation") === "restore";
  const next = restore ? RECOMMENDED_LATE_GRACE_MINUTES : Number(formData.get("graceMinutes"));
  await saveLateGraceMinutes(session.user.id, next, Number(formData.get("expected")));
  revalidatePath("/desk/automations");
}

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

import { createOpsAgentKey, revokeOpsAgentKey } from "@/domains/system-issues/ops-auth";

export async function createOpsAgentKeyAction(
  _previous: { key: string | null; error: string | null },
  formData: FormData,
): Promise<{ key: string | null; error: string | null }> {
  const session = await requireRole("OWNER");
  try {
    const result = await createOpsAgentKey(session.user.id, String(formData.get("label") ?? ""));
    revalidatePath("/desk/automations");
    return { key: result.key, error: null };
  } catch {
    return { key: null, error: "Unable to create a key. Check the label and try again." };
  }
}

export async function revokeOpsAgentKeyAction(formData: FormData): Promise<void> {
  const session = await requireRole("OWNER");
  await revokeOpsAgentKey(session.user.id, String(formData.get("keyId") ?? ""));
  revalidatePath("/desk/automations");
}


import { redirect } from "next/navigation";
import { BACKUP_RETENTION_RECOMMENDED_DAYS, saveBackupRetentionDays } from "@/domains/backup/dashboard";
import { retryBackupNow } from "@/domains/backup/manual";

export async function saveBackupRetentionAction(formData: FormData): Promise<void> {
  const session = await requireRole("OWNER");
  const next = formData.get("operation") === "restore"
    ? BACKUP_RETENTION_RECOMMENDED_DAYS : Number(formData.get("days"));
  await saveBackupRetentionDays(session.user.id, next, Number(formData.get("expected")));
  revalidatePath("/desk/automations");
}

export async function retryBackupAction(): Promise<void> {
  const session = await requireRole("OWNER");
  let message: string;
  try {
    const result = await retryBackupNow(session.user.id);
    message = result.outcome === "RAN" ? "verified" :
      result.outcome === "ALREADY_RAN" ? "busy" : "failed";
  } catch {
    message = "unavailable";
  }
  revalidatePath("/desk/automations");
  redirect("/desk/automations?backupMessage=" + message + "#backup-settings");
}
