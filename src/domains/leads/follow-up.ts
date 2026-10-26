import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { addBusinessDays, businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { lockLiveLeadInTx } from "./lock";

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

/**
 * LD-1: owner, admin, staff with the Leads screen, or the lead's assignee
 * sets (or clears with null) the next follow-up date. One transaction: the
 * row is locked, the lead must be CONTACTED (and not merged), and the version
 * must match the one the screen showed — a stale save is refused instead of
 * overwriting someone else's change. Only nextFollowUpOn (and the version)
 * change; status and firstContactedAt are never touched here.
 */
export async function setLeadFollowUp(
  actorId: string,
  leadId: string,
  expectedVersion: number,
  dateKey: string | null,
): Promise<void> {
  const followUpOn = dateKey === null ? null : parseFollowUpKey(dateKey, new Date());
  await prisma.$transaction(async (tx) => {
    const locked = await lockLiveLeadInTx(tx, leadId);
    // Owner/admin/staff with the Leads screen first; an assignee whose role
    // changed since they were given the lead can still set the follow-up on
    // their own lead.
    let allowed = false;
    try {
      await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN", "STAFF"]);
      allowed = true;
    } catch {
      if (locked.assignedToUserId === actorId) {
        await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN", "STAFF"]);
        allowed = true;
      }
    }
    if (!allowed) {
      throw new Error("This account no longer has access to make that change.");
    }
    if (locked.status !== "CONTACTED") {
      throw new Error("Only a contacted lead can have a follow-up date.");
    }
    const before = await tx.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { nextFollowUpOn: true, version: true },
    });
    if (before.version !== expectedVersion) {
      throw new Error("This lead changed in another session. Reload before saving.");
    }
    await tx.lead.update({
      where: { id: leadId },
      data: { nextFollowUpOn: followUpOn, version: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "lead.follow_up_set",
        entityType: "Lead",
        entityId: leadId,
        oldValue: { nextFollowUpOn: before.nextFollowUpOn?.toISOString() ?? null },
        newValue: { nextFollowUpOn: followUpOn?.toISOString() ?? null },
      },
    });
  });
}
