"use server";
// FEE-1: Chris confirms the Colorado consumer-lease notification was filed (owner-only, audited). Never ticked for him.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey } from "@/lib/business-date";

export type UcccFilingState = { error: string; success: string };

export async function saveUcccFilingAction(_previous: UcccFilingState, form: FormData): Promise<UcccFilingState> {
  const session = await requireRole("OWNER");
  try {
    const clear = form.get("operation") === "clear";
    const raw = form.get("filedOn");
    const filedOn = clear ? null : typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? businessDateFromKey(raw) : null;
    if (!clear && !filedOn) return { error: "Choose the day it was filed.", success: "" };
    await prisma.$transaction(async (tx) => {
      await assertActiveTeamActor(tx, session.user.id, ["OWNER"]);
      await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = ${"singleton"} FOR UPDATE`;
      const before = await tx.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { ucccNotificationFiledOn: true } });
      await tx.businessSettings.update({ where: { id: "singleton" }, data: { ucccNotificationFiledOn: filedOn } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id, action: "settings.uccc_filing.update", entityType: "BusinessSettings", entityId: "singleton",
          oldValue: { filedOn: before.ucccNotificationFiledOn }, newValue: { filedOn },
        },
      });
    });
    revalidatePath("/desk/settings");
    revalidatePath("/desk/agreements/new");
    return { error: "", success: filedOn ? "Saved. The reminder on new rentals is gone." : "Cleared." };
  } catch {
    return { error: "Could not save. Review and try again.", success: "" };
  }
}
