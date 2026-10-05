"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import {
  fulfillPrivacyDeletion,
  rejectPrivacyRequest,
  verifyPrivacyRequestByOwner,
} from "@/domains/privacy";

async function ownerId(): Promise<string> {
  const session = await requireRole("OWNER");
  return session.user.id;
}

export async function verifyPrivacyByPhoneAction(formData: FormData): Promise<never> {
  const userId = await ownerId();
  const requestId = String(formData.get("requestId") ?? "");
  try {
    await verifyPrivacyRequestByOwner(userId, requestId);
    redirect("/desk/privacy?updated=verified");
  } catch {
    redirect("/desk/privacy?error=verify");
  }
}

export async function fulfillPrivacyDeletionAction(formData: FormData): Promise<never> {
  const userId = await ownerId();
  const requestId = String(formData.get("requestId") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  try {
    if (confirmation !== "DELETE") throw new Error("Confirmation required.");
    await fulfillPrivacyDeletion(userId, requestId, "DELETE");
    redirect("/desk/privacy?updated=deleted");
  } catch {
    redirect("/desk/privacy?error=delete");
  }
}

export async function rejectPrivacyRequestAction(formData: FormData): Promise<never> {
  const userId = await ownerId();
  const requestId = String(formData.get("requestId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    await rejectPrivacyRequest(userId, requestId, reason);
    redirect("/desk/privacy?updated=rejected");
  } catch {
    redirect("/desk/privacy?error=reject");
  }
}
