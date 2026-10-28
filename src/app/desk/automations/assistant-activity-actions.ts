"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { decideJournalApproval } from "@/domains/agent-control/journal";

async function decide(form: FormData, approved: boolean) {
  const session = await requireRole("OWNER");
  const operationId = String(form.get("operationId") ?? "");
  if (!/^c[a-z0-9]{12,80}$/i.test(operationId)) throw new Error("Choose a waiting assistant action.");
  await decideJournalApproval(session.user.id, operationId, approved);
  revalidatePath("/desk/automations");
  revalidatePath("/desk/today");
}

export async function approveAssistantAction(form: FormData) {
  await decide(form, true);
}
export async function declineAssistantAction(form: FormData) {
  await decide(form, false);
}
