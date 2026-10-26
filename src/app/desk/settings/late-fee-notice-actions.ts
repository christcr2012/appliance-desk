"use server";
// FEE-1: owner setting "how many days before a late fee the customer is warned" (starting value 2; 1 to 5).
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { LATE_FEE_NOTICE_DAYS_DEFAULT, validateNoticeDays } from "@/domains/billing/late-fee-rules";

export type LateFeeNoticeState = { error: string; success: string };

export async function saveLateFeeNoticeAction(_previous: LateFeeNoticeState, form: FormData): Promise<LateFeeNoticeState> {
  const session = await requireRole("OWNER");
  try {
    const restore = form.get("operation") === "restore";
    const raw = form.get("lateFeeNoticeDaysBefore");
    const days = restore ? LATE_FEE_NOTICE_DAYS_DEFAULT : validateNoticeDays(Number(typeof raw === "string" ? raw.trim() : ""));
    await prisma.$transaction(async (tx) => {
      await assertActiveTeamActor(tx, session.user.id, ["OWNER"]);
      await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = ${"singleton"} FOR UPDATE`;
      const before = await tx.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { lateFeeNoticeDaysBefore: true } });
      await tx.businessSettings.update({ where: { id: "singleton" }, data: { lateFeeNoticeDaysBefore: days } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "settings.late_fee_notice_days.update",
          entityType: "BusinessSettings",
          entityId: "singleton",
          oldValue: { days: before.lateFeeNoticeDaysBefore },
          newValue: { days, restored: restore },
        },
      });
    });
    revalidatePath("/desk/settings");
    return { error: "", success: restore ? `Put back to the recommended ${days} days.` : `Saved. Customers are warned ${days} day${days === 1 ? "" : "s"} before a late fee.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { error: /^Choose a whole number/.test(message) ? message : "Could not save. Review and try again.", success: "" };
  }
}
