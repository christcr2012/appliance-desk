"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import {
  requestEarlyTermination,
  setAutoRenew,
  type EarlyTerminationQuote,
} from "@/domains/agreements/term";
import { requestMonthToMonthEnd } from "@/domains/agreements/month-to-month";

export type RentalActionState = { status: "success" } | { status: "error"; message: string };
export type TurnOffAutoRenewState = RentalActionState;
export type EndRentalState = RentalActionState;

const schema = z.object({ agreementId: z.string().min(1) });
const autoRenewSchema = z.object({
  agreementId: z.string().min(1),
  enabled: z.boolean(),
  termsVersion: z.string(),
});

export async function setCustomerAutoRenewAction(
  input: z.input<typeof autoRenewSchema>,
): Promise<RentalActionState> {
  const session = await requireSession();
  const parsed = autoRenewSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "That rental could not be found." };
  try {
    await setAutoRenew(
      { userId: session.user.id, kind: "customer" },
      parsed.data.agreementId,
      { enabled: parsed.data.enabled, termsVersion: parsed.data.enabled ? parsed.data.termsVersion : "" },
    );
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "That could not be saved." };
  }
  revalidatePath("/account/rentals");
  return { status: "success" };
}

/** Backward-compatible action used by the existing button. */
export async function turnOffAutoRenewAction(input: { agreementId: string }): Promise<TurnOffAutoRenewState> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "That rental could not be found." };
  return setCustomerAutoRenewAction({ agreementId: parsed.data.agreementId, enabled: false, termsVersion: "" });
}

const earlyEndSchema = z.object({
  agreementId: z.string().min(1),
  effectiveOn: z.string().datetime(),
  remainingTermMonths: z.number().int().min(0),
  remainingRentCents: z.number().int().min(0),
  feeCents: z.number().int().min(0),
  unusedTermCents: z.number().int().min(0),
  unusedTermTreatment: z.enum(["REFUND", "CREDIT", "RETAIN"]),
  prepaidReviewRequired: z.boolean(),
  unpaidBalanceCents: z.number().int().min(0),
  policyVersion: z.string().min(1),
});

/**
 * A customer confirms the exact fixed-term ending quote shown on screen.
 * The domain recalculates it under lock and refuses the request if any number
 * or policy version changed. Nothing is charged automatically.
 */
export async function endFixedTermRentalAction(
  input: z.input<typeof earlyEndSchema>,
): Promise<RentalActionState> {
  const session = await requireSession();
  const parsed = earlyEndSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "That ending quote is no longer valid." };
  const p = parsed.data;
  const quote: EarlyTerminationQuote = {
    requestedOn: new Date(),
    effectiveOn: new Date(p.effectiveOn),
    remainingTermMonths: p.remainingTermMonths,
    remainingRentCents: p.remainingRentCents,
    feeCents: p.feeCents,
    unusedTermCents: p.unusedTermCents,
    unusedTermTreatment: p.unusedTermTreatment,
    prepaidReviewRequired: p.prepaidReviewRequired,
    unpaidBalanceCents: p.unpaidBalanceCents,
    policyVersion: p.policyVersion,
  };
  try {
    await requestEarlyTermination(
      { userId: session.user.id, kind: "customer" },
      p.agreementId,
      quote,
    );
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "That could not be saved." };
  }
  revalidatePath("/account/rentals");
  return { status: "success" };
}

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
