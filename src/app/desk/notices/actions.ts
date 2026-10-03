"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { markNoticeDeliveredByHand } from "@/domains/notices";

export type NoticeActionState = { status: "success" } | { status: "error"; message: string };

const schema = z.object({ noticeId: z.string().min(1), how: z.string().min(1).max(80) });

/** Record that a waiting notice was delivered another way. Owner and admin only. */
export async function markNoticeDeliveredAction(input: { noticeId: string; how: string }): Promise<NoticeActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Say how you delivered it." };
  try {
    await markNoticeDeliveredByHand(session.user.id, parsed.data.noticeId, parsed.data.how);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "That could not be saved." };
  }
  revalidatePath("/desk/notices");
  revalidatePath("/desk/today");
  return { status: "success" };
}
