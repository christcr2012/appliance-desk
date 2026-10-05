"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { setAutoRenew } from "@/domains/agreements/term";
import { requestMonthToMonthEnd } from "@/domains/agreements/month-to-month";

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

export type EndRentalState = { status: "success" } | { status: "error"; message: string };

const endSchema = z.object({
  agreementId: z.string().min(1),
  effectiveOn: z.string().datetime(),
  lastBilledDay: z.string().datetime(),
  noticeDays: z.number().int(),
  termsVersion: z.number().int(),
});

/** A customer ends their own month-to-month rental. The quote they saw must still be true when they confirm. */
export async function endMonthToMonthRentalAction(input: z.input<typeof endSchema>): Promise<EndRentalState> {
  const session = await requireSession();
  const parsed = endSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "That rental could not be found." };
  const p = parsed.data;
  try {
    await requestMonthToMonthEnd(
      { userId: session.user.id, kind: "customer" },
      p.agreementId,
      {
        requestedOn: new Date(),
        effectiveOn: new Date(p.effectiveOn),
        lastBilledDay: new Date(p.lastBilledDay),
        noticeDays: p.noticeDays,
        termsVersion: p.termsVersion,
        feeCents: 0,
      },
    );
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "That could not be saved." };
  }
  revalidatePath("/account/rentals");
  return { status: "success" };
}
