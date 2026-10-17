import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { addBusinessDays, businessDateFromKey, businessDateKey } from "@/lib/business-date";

export const RECOMMENDED_LEAD_RESPONSE_DAYS = 0;
export const DEFAULT_FOLLOW_UP_DAYS = 2;

export async function getLeadResponseDays(): Promise<number> {
  const s = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { leadResponseDays: true } });
  return s?.leadResponseDays ?? RECOMMENDED_LEAD_RESPONSE_DAYS;
}

/** Owner-only, audited, compare-and-set. 0 means "the same day the lead arrives". */
export async function saveLeadResponseDays(actorId: string, days: number, expectedDays: number): Promise<void> {
  if (!Number.isInteger(days) || days < 0 || days > 14) throw new Error("Enter a whole number of days from 0 to 14.");
  if (!Number.isInteger(expectedDays)) throw new Error("Reload the page and try again.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const changed = await tx.businessSettings.updateMany({
      where: { id: "singleton", leadResponseDays: expectedDays }, data: { leadResponseDays: days },
    });
    if (changed.count !== 1) throw new Error("This setting was changed in another session. Reload before saving.");
    await tx.auditLog.create({
      data: { userId: actorId, action: "lead.response_days.update", entityType: "BusinessSettings", entityId: "singleton",
        oldValue: { leadResponseDays: expectedDays }, newValue: { leadResponseDays: days } },
    });
  });
}

/** The follow-up date the "Next follow-up date?" box starts with: two days from today (Colorado date). */
export function defaultFollowUpKey(now: Date): string {
  return businessDateKey(addBusinessDays(now, DEFAULT_FOLLOW_UP_DAYS));
}

/** Turns a typed YYYY-MM-DD into Colorado midnight; rejects bad or past dates. */
export function parseFollowUpKey(key: string, now: Date): Date {
  const date = businessDateFromKey(key);
  if (!date) throw new Error("Choose a real follow-up date.");
  if (businessDateKey(date) < businessDateKey(now)) throw new Error("The follow-up date can't be in the past.");
  return date;
}

/** Owner/admin sets (or clears with null) the next follow-up date; audited. */
export async function setLeadFollowUp(actorId: string, leadId: string, followUpOn: Date | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const before = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, select: { nextFollowUpOn: true } });
    await tx.lead.update({ where: { id: leadId }, data: { nextFollowUpOn: followUpOn } });
    await tx.auditLog.create({
      data: { userId: actorId, action: "lead.follow_up", entityType: "Lead", entityId: leadId,
        oldValue: { nextFollowUpOn: before.nextFollowUpOn?.toISOString() ?? null },
        newValue: { nextFollowUpOn: followUpOn?.toISOString() ?? null } },
    });
  });
}
