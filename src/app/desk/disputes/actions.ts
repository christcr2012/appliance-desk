"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  approveAndSendEvidence, clearBankDebitBlock, markBankDisputeHandled, saveAchDisputeWindowDays,
} from "@/domains/disputes/actions";
import { RECOMMENDED_ACH_DISPUTE_WINDOW_DAYS } from "@/domains/disputes/rules";

export type DisputeActionState = { status: "idle" } | { status: "success"; message: string } | { status: "error"; message: string };

const fail = (error: unknown): DisputeActionState => ({
  status: "error",
  message: error instanceof Error ? error.message : "Couldn't save that.",
});

function refresh(id?: string) {
  revalidatePath("/desk/disputes");
  if (id) revalidatePath(`/desk/disputes/${id}`);
  revalidatePath("/desk/today");
  revalidatePath("/desk/tasks");
}

export async function approveAndSendAction(disputeId: string): Promise<DisputeActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    const result = await approveAndSendEvidence(session.user.id, disputeId);
    refresh(disputeId);
    return {
      status: "success",
      message: result.photosDropped > 0
        ? `Sent to Stripe. Some older photos were left out to fit Stripe's size limit (${result.photosIncluded} included).`
        : "Sent to Stripe. The bank decides, usually within a few weeks.",
    };
  } catch (error) {
    refresh(disputeId);
    return fail(error);
  }
}

export async function markBankHandledAction(disputeId: string, note: string): Promise<DisputeActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await markBankDisputeHandled(session.user.id, disputeId, note);
    refresh(disputeId);
    return { status: "success", message: "Saved. It's off your To do list." };
  } catch (error) {
    return fail(error);
  }
}

export async function allowBankAutopayAction(customerId: string, disputeId: string): Promise<DisputeActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await clearBankDebitBlock(session.user.id, customerId);
    refresh(disputeId);
    return { status: "success", message: "Bank autopay is allowed again. The customer must add a bank account again when they next pay." };
  } catch (error) {
    return fail(error);
  }
}

export async function saveAchWindowAction(_previous: DisputeActionState, form: FormData): Promise<DisputeActionState> {
  const session = await requireRole("OWNER");
  try {
    const restore = form.get("operation") === "restore";
    const raw = form.get("achDisputeWindowDays");
    const days = await saveAchDisputeWindowDays(session.user.id, restore ? RECOMMENDED_ACH_DISPUTE_WINDOW_DAYS : Number(typeof raw === "string" ? raw.trim() : ""));
    refresh();
    revalidatePath("/desk/settings");
    return { status: "success", message: `Saved. Deposit refunds for bank payments now wait ${days} days after the debit.` };
  } catch (error) {
    return fail(error);
  }
}
