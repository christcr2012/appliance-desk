import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

/**
 * Who may record that a customer notice was delivered by hand, and how many days to add for mail in transit
 * (Batch B2, B2-17). Only the OWNER can change these; the person is re-checked inside the transaction and every
 * change is logged.
 */
export const NOTICE_CERTIFIER_CHOICES = ["OWNER", "OWNER_AND_ADMIN"] as const;
export type NoticeCertifierChoice = (typeof NOTICE_CERTIFIER_CHOICES)[number];
export const RECOMMENDED_NOTICE_CERTIFIER: NoticeCertifierChoice = "OWNER";
export const RECOMMENDED_MAIL_NOTICE_TRANSIT_DAYS = 3;
export const MAIL_NOTICE_TRANSIT_DAYS_MAX = 14;

export type NoticeDeliveryValues = { noticeCertifierRoles: NoticeCertifierChoice; mailNoticeTransitDays: string };

export function noticeDeliveryDefaults(settings: { noticeCertifierRoles?: string; mailNoticeTransitDays?: number }): NoticeDeliveryValues {
  return {
    noticeCertifierRoles: settings.noticeCertifierRoles === "OWNER_AND_ADMIN" ? "OWNER_AND_ADMIN" : RECOMMENDED_NOTICE_CERTIFIER,
    mailNoticeTransitDays: String(settings.mailNoticeTransitDays ?? RECOMMENDED_MAIL_NOTICE_TRANSIT_DAYS),
  };
}

export function parseNoticeDelivery(
  raw: Record<string, unknown>,
): { success: true; roles: NoticeCertifierChoice; days: number } | { success: false; message: string } {
  const roles = raw?.noticeCertifierRoles;
  if (roles !== "OWNER" && roles !== "OWNER_AND_ADMIN") return { success: false, message: "Choose who may record a delivery." };
  const text = typeof raw.mailNoticeTransitDays === "number" ? String(raw.mailNoticeTransitDays) : raw.mailNoticeTransitDays;
  if (typeof text !== "string" || !/^\d{1,2}$/.test(text.trim())) {
    return { success: false, message: "Days for mail to arrive: enter a whole number from 0 to 14." };
  }
  const days = Number(text.trim());
  if (days > MAIL_NOTICE_TRANSIT_DAYS_MAX) {
    return { success: false, message: `Days for mail to arrive: enter a whole number from 0 to ${MAIL_NOTICE_TRANSIT_DAYS_MAX}.` };
  }
  return { success: true, roles, days };
}

export async function setNoticeDeliverySettings(userId: string, roles: NoticeCertifierChoice, days: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const before = await tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { noticeCertifierRoles: true, mailNoticeTransitDays: true },
    });
    await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", noticeCertifierRoles: roles, mailNoticeTransitDays: days },
      update: { noticeCertifierRoles: roles, mailNoticeTransitDays: days },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "settings.notice_delivery",
        entityType: "BusinessSettings",
        entityId: "singleton",
        oldValue: before ?? {},
        newValue: { noticeCertifierRoles: roles, mailNoticeTransitDays: days },
      },
    });
  });
}
