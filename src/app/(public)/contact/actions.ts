"use server";

import { createLead } from "@/domains/leads";
import { leadFormSchema } from "@/domains/leads/schema";

export type SubmitLeadState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

export async function submitLead(
  raw: unknown,
): Promise<SubmitLeadState> {
  const parsed = leadFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields and try again.",
    };
  }

  try {
    await createLead(parsed.data);
    return { status: "success" };
  } catch (error) {
    console.error("[leads] Failed to save lead", error);
    return {
      status: "error",
      message:
        "Something went wrong saving your request. Please try again, or call us directly.",
    };
  }
}
