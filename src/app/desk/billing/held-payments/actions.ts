"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { resolveHeldPaymentAsCredit, resolveHeldPaymentAsPaid } from "@/domains/billing/held-payments";
import { refundHeldPayment } from "@/domains/billing/refunds";

export type HeldPaymentActionState =
  | { status: "success" }
  | { status: "pending"; message: string }
  | { status: "error"; message: string };

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
      const refund = await refundHeldPayment(session.user.id, parsed.data.paymentId);
      if (refund.outcome !== "SUCCEEDED") {
        revalidatePath("/desk/billing/held-payments");
        return {
          status: "pending",
          message:
            "Your decision to refund was saved, but the card processor has not confirmed the refund yet. It is retried automatically and shows under “Refunds waiting on the card processor” below.",
        };
      }
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
