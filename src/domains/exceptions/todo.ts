import { createHash } from "node:crypto";
import type { ExceptionItem } from "./rules";
import { businessDateKey } from "@/lib/business-date";

export function todoKey(item: Pick<ExceptionItem, "category" | "href" | "title">): string {
  const recordLink = /\/[a-z0-9_-]{16,}(?:\/|$)/i.test(item.href);
  const identity = [item.category, item.href, recordLink ? "" : item.title].join("|");
  return createHash("sha256").update(identity).digest("hex");
}
const ACTION_LABEL: Record<string, string> = {
  RENTAL_ENDING_SOON: "Decide",
  PICKUP_UNSCHEDULED: "Schedule pickup",
  RETIRED_APPLIANCE_PLAN: "Decide",
  RETIRED_SALE_TAX_REVIEW: "Open sale",
  APPROVAL_REQUEST: "Approve or decline",
  GOAL_BEHIND: "See goals",
  IDLE_APPLIANCES: "See idle appliances",
  LOW_UTILIZATION: "See fleet",
  VISIT_NEEDS_ASSIGNMENT: "Assign / set a time",
  CLEANING_NEEDED: "Open appliance",
  PAST_DUE_INVOICE: "Review unpaid invoice",
  BANK_PAYMENT_SLOW: "See bank payment",
  LATE_FEE_REVIEW: "Open the bill",
  HELD_PAYMENT_DECISION: "Decide",
  DEPOSIT_DECISION: "Decide",
  NEW_LEAD_CONTACT: "Contact lead",
  LEAD_FOLLOW_UP: "Follow up",
  APPROVED_QUOTE: "Make rental",
  SIGNING_PAYMENT_DUE: "Review signing payment",
  UNSIGNED_AGREEMENT: "Follow up",
  OVERDUE_JOB: "Open visit",
  EARLY_ENDING_NOT_DONE: "Schedule pickup",
  TAX_RETURN_DUE: "File return",
  TAX_LICENSE_RENEWAL: "Renew license",
  TAX_SETUP_CHECK: "Check setup",
  BUSINESS_PAPERWORK: "Open paperwork",
  TAX_AMENDMENT_DUE: "Review amendment",
  TAX_FILING_NOT_READY: "Prepare filing",
  PURCHASE_USE_TAX_DUE: "File use tax",
  UNREVIEWED_MAINTENANCE_REQUEST: "Review request",
  UNINSPECTED_RETURN: "Inspect appliance",
  MISSING_REPAIR_COST: "Enter repair cost",
  STALE_RESERVATION: "Review reservation",
  APPLIANCE_MAINTENANCE_DUE: "Schedule service",
  OLD_SET_APPLIANCE: "Split machines",
  OUT_OF_SERVICE: "Review repair",
  FEEDBACK_WAITING: "Read",
};
export function todoAction(item: ExceptionItem) {
  return item.primaryAction ?? { href: item.href, label: ACTION_LABEL[item.category] ?? "Review item" };
}
export function todoDeadlineLabel(dueOn: Date | undefined, now: Date, dateOnly = false): string | null {
  if (!dueOn || !Number.isFinite(dueOn.getTime())) return null;
  const key = dateOnly ? dueOn.toISOString().slice(0, 10) : businessDateKey(dueOn);
  const today = businessDateKey(now);
  const days = Math.round((Date.parse(key + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
  if (days < 0) return "Overdue " + Math.abs(days) + (days === -1 ? " day" : " days");
  if (days === 0) return "Due today";
  return "Due " + key + " (in " + days + (days === 1 ? " day)" : " days)");
}

import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

export function validateSnoozeInput(input: {
  key: string; until: string; reason: string;
}) {
  if (!/^[a-f0-9]{64}$/.test(input.key)) throw new Error("Invalid To do item.");
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) throw new Error("Give a reason (3–500 characters).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.until)) throw new Error("Choose a date.");
  const target = new Date(input.until + "T12:00:00Z");
  if (!Number.isFinite(target.getTime()) || target.toISOString().slice(0, 10) !== input.until)
    throw new Error("Choose a valid date.");
  const today = businessDateKey(new Date());
  const max = new Date(today + "T00:00:00Z");
  max.setUTCDate(max.getUTCDate() + 90);
  if (input.until <= today || input.until > max.toISOString().slice(0, 10))
    throw new Error("Choose a future date within 90 days.");
  return { target, reason };
}

export async function snoozeTodo(input: {
  key: string; until: string; reason: string; actorUserId: string;
  active: ExceptionItem[];
}) {
  const { target, reason } = validateSnoozeInput(input);
  const item = input.active.find((entry) => todoKey(entry) === input.key);
  if (!item) throw new Error("This To do item changed. Refresh and try again.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, input.actorUserId, ["OWNER", "ADMIN"]);
    // Static, parameterized SQL locks an existing snooze before its revision.
    await tx.$queryRawUnsafe('SELECT "key" FROM "ExceptionSnooze" WHERE "key" = $1 FOR UPDATE', input.key);
    await tx.exceptionSnooze.upsert({
      where: { key: input.key },
      create: {
        key: input.key, category: item.category, href: item.href,
        snoozedUntil: target, reason, actorUserId: input.actorUserId,
      },
      update: { snoozedUntil: target, reason, actorUserId: input.actorUserId },
    });
    await tx.auditLog.create({
      data: {
        userId: input.actorUserId, action: "todo.snoozed",
        entityType: "ExceptionSnooze", entityId: input.key,
        newValue: { until: input.until, reason, category: item.category, href: item.href },
      },
    });
  });
}

export async function unsnoozeTodo(input: { key: string; actorUserId: string }) {
  if (!/^[a-f0-9]{64}$/.test(input.key)) throw new Error("Invalid To do item.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, input.actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRawUnsafe('SELECT "key" FROM "ExceptionSnooze" WHERE "key" = $1 FOR UPDATE', input.key);
    const previous = await tx.exceptionSnooze.findUnique({ where: { key: input.key } });
    if (!previous) return;
    await tx.exceptionSnooze.delete({ where: { key: input.key } });
    await tx.auditLog.create({ data: { userId: input.actorUserId, action: "todo.unsnoozed", entityType: "ExceptionSnooze", entityId: input.key } });
  });
}
