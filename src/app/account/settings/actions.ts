"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { updateSmsPreference } from "@/domains/portal";

export type SmsPreferenceActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

const smsPreferenceSchema = z.object({
  optedIn: z.coerce.boolean(),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
});

/** The customer's own preference — requireSession only, never a role
 * check, since this is entirely about their own account. Identity comes
 * from the session, never anything client-supplied — see
 * updateSmsPreference. */
export async function updateSmsPreferenceAction(
  raw: Record<string, unknown>,
): Promise<SmsPreferenceActionState> {
  const session = await requireSession();

  const parsed = smsPreferenceSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "Please fix the highlighted fields." };
  }

  try {
    await updateSmsPreference(session.user.id, {
      optedIn: parsed.data.optedIn,
      phone: parsed.data.phone || null,
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't save that — try again.",
    };
  }

  revalidatePath("/account/settings");
  return { status: "success" };
}
