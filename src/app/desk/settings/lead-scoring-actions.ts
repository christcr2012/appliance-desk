"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  saveLeadScoringPolicy,
  type LeadScoringPolicyInput,
} from "@/domains/leads/scoring-policy";

export async function updateLeadScoringPolicyAction(
  input: LeadScoringPolicyInput,
): Promise<{ status: "success"; version: number } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    const saved = await saveLeadScoringPolicy(session.user.id, input);
    revalidatePath("/desk/settings");
    revalidatePath("/desk/leads");
    return { status: "success", version: saved.version };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't save lead scoring settings.",
    };
  }
}
