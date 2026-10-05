"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { confirmEmailOutcome, recordNoticeDelivery } from "@/domains/notices";
import { resolveMissedNotice, type MissedNoticeChoice } from "@/domains/notices/resolution";
import { extendBillingForDeliveredAutoRenewals } from "@/domains/agreements/auto-renew";

export type NoticeActionState = { status: "success"; redirectTo?: string } | { status: "error"; message: string };

const deliverySchema = z.object({
  noticeId: z.string().min(1),
  channel: z.enum(["MAIL", "BUSINESS_MAILBOX", "IN_PERSON_WRITTEN", "TEXT_OR_APP"]),
  date: z.string().min(1),
  sentTo: z.string().min(1).max(200),
  note: z.string().min(1).max(500),
});

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function refresh() {
  revalidatePath("/desk/notices");
  revalidatePath("/desk/today");
}

/** Record that a notice was delivered a real way (not a phone call). Who may do this is an owner setting. */
export async function recordNoticeDeliveryAction(input: z.input<typeof deliverySchema>): Promise<NoticeActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = deliverySchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Fill in how, when and to what address or number it was delivered, with a short note." };
  try {
    const { noticeId, ...rest } = parsed.data;
    await recordNoticeDelivery(session.user.id, noticeId, rest);
    await extendBillingForDeliveredAutoRenewals();
  } catch (error) {
    return { status: "error", message: message(error, "That could not be saved.") };
  }
  refresh();
  return { status: "success" };
}

const confirmSchema = z.object({
  noticeId: z.string().min(1),
  answer: z.union([z.object({ sent: z.literal(true), acceptedOn: z.string().min(1) }), z.object({ sent: z.literal(false) })]),
});

/** For an email that may or may not have gone out: the owner checked, and says which. */
export async function confirmEmailOutcomeAction(input: z.input<typeof confirmSchema>): Promise<NoticeActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Say whether it went out, and the date the email service shows." };
  try {
    await confirmEmailOutcome(session.user.id, parsed.data.noticeId, parsed.data.answer);
    if (parsed.data.answer.sent) await extendBillingForDeliveredAutoRenewals();
  } catch (error) {
    return { status: "error", message: message(error, "That could not be saved.") };
  }
  refresh();
  return { status: "success" };
}

const choiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CANCEL_AUTOMATIC_RENEWAL"), schedulePickup: z.boolean() }),
  z.object({ kind: z.literal("SEND_NEW_RENEWAL"), termMonths: z.union([z.null(), z.literal(6), z.literal(12)]) }),
  z.object({ kind: z.literal("MOVE_RENEWAL_LATER") }),
  z.object({ kind: z.literal("KEEP_WAITING"), remindOn: z.string().min(1) }),
  z.object({ kind: z.literal("END_RENTAL") }),
]);

/** One decision from the "Fix a missed reminder" screen. Owner and admin only; refused if it changed since it was opened. */
export async function resolveMissedNoticeAction(input: {
  noticeId: string;
  expectedUpdatedAt: string;
  choice: MissedNoticeChoice;
  note: string;
}): Promise<NoticeActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const choice = choiceSchema.safeParse(input.choice);
  const expected = new Date(input.expectedUpdatedAt);
  if (!choice.success || !Number.isFinite(expected.getTime())) return { status: "error", message: "Choose one of the options and add a note." };
  try {
    const { redirectTo } = await resolveMissedNotice(session.user.id, input.noticeId, expected, choice.data, input.note);
    refresh();
    revalidatePath("/desk/agreements");
    return { status: "success", redirectTo };
  } catch (error) {
    refresh();
    return { status: "error", message: message(error, "That could not be done.") };
  }
}
