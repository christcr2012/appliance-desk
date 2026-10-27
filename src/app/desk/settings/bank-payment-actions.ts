"use server";
// BILL-1: owner setting "how many banking days before a bank payment goes on To do" (starting value 6; banks usually take up to 4).
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { BANK_PAYMENT_SLOW_DAYS_DEFAULT, validateBankPaymentSlowDays } from "@/domains/billing/in-flight";

export type BankPaymentSettingsState = { error: string; success: string };

export async function saveBankPaymentSettingsAction(_previous: BankPaymentSettingsState, form: FormData): Promise<BankPaymentSettingsState> {
  const session = await requireRole("OWNER");
  try {
    const restore = form.get("operation") === "restore";
    const raw = form.get("bankPaymentSlowBusinessDays");
    const days = restore ? BANK_PAYMENT_SLOW_DAYS_DEFAULT : validateBankPaymentSlowDays(Number(typeof raw === "string" ? raw.trim() : ""));
    await prisma.$transaction(async (tx) => {
      await assertActiveTeamActor(tx, session.user.id, ["OWNER"]);
      await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = ${"singleton"} FOR UPDATE`;
      const before = await tx.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { bankPaymentSlowBusinessDays: true } });
      await tx.businessSettings.update({ where: { id: "singleton" }, data: { bankPaymentSlowBusinessDays: days } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "settings.bank_payment_slow_days.update",
          entityType: "BusinessSettings",
          entityId: "singleton",
          oldValue: { days: before.bankPaymentSlowBusinessDays },
          newValue: { days, restored: restore },
        },
      });
    });
    revalidatePath("/desk/settings");
    revalidatePath("/desk/today");
    return { error: "", success: restore ? `Put back to the recommended ${days} banking days.` : `Saved. A bank payment now goes on your To do list after ${days} banking days.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { error: /^Choose a whole number/.test(message) ? message : "Could not save. Review and try again.", success: "" };
  }
}
