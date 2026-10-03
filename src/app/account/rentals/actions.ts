"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { setAutoRenew } from "@/domains/agreements/term";

export type TurnOffAutoRenewState = { status: "success" } | { status: "error"; message: string };

const schema = z.object({ agreementId: z.string().min(1) });

/** A customer turns off automatic renewal on their own rental (Colorado expects an easy online way to cancel). */
export async function turnOffAutoRenewAction(input: { agreementId: string }): Promise<TurnOffAutoRenewState> {
  const session = await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "That rental could not be found." };
  try {
    await setAutoRenew({ userId: session.user.id, kind: "customer" }, parsed.data.agreementId, {
      enabled: false,
      termsVersion: "",
    });
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "That could not be saved." };
  }
  revalidatePath("/account/rentals");
  return { status: "success" };
}
