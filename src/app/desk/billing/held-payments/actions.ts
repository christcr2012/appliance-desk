"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { resolveHeldPaymentAsCredit, resolveHeldPaymentAsPaid } from "@/domains/billing/held-payments";
import { refundHeldPayment } from "@/domains/billing/refunds";

export type HeldPaymentActionState = { status: "success" } | { status: "error"; message: string };

const schema = z.object({
  paymentId: z.string().min(1),
  option: z.enum(["MARK_PAID", "CREDIT", "REFUND"]),
});

/** Settle one held payment. Owner and admin only: this moves real money. */
export async function resolveHeldPaymentAction(input: {
  paymentId: string;
  option: "MARK_PAID" | "CREDIT" | "REFUND";
}): Promise<HeldPaymentActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Choose one of the options." };
  try {
    if (parsed.data.option === "MARK_PAID") {
      await resolveHeldPaymentAsPaid(session.user.id, parsed.data.paymentId);
    } else if (parsed.data.option === "CREDIT") {
      await resolveHeldPaymentAsCredit(session.user.id, parsed.data.paymentId);
    } else {
      await refundHeldPayment(session.user.id, parsed.data.paymentId);
    }
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "That could not be saved. Nothing was changed.",
    };
  }
  revalidatePath("/desk/billing/held-payments");
  revalidatePath("/desk/billing");
  revalidatePath("/desk/revenue");
  return { status: "success" };
}
