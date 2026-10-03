import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendCustomerEmail } from "@/lib/customer-email";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDaysBetween } from "@/lib/business-date";

/**
 * Messages the customer is owed, kept exactly as written.
 *
 * A notice is created in the same database transaction as the thing that makes it
 * necessary (for the renewal reminder: queuing the automatic renewal), so a
 * renewal can never exist without its reminder. Sending is separate and honest:
 * a notice is SENT only when the email provider accepted it, or when the owner says
 * they delivered it another way (phone, mail, in person). While live customer email
 * is off (a decision only the owner can make) notices simply wait as PENDING and are
 * shown in "Needs your attention"; nothing is silently skipped and nothing is
 * claimed as sent that was not.
 */

export type NoticeKind = "RENEWAL_REMINDER";

export async function createNoticeInTx(
  tx: Prisma.TransactionClient,
  input: {
    customerId: string;
    agreementId: string | null;
    kind: NoticeKind;
    dedupeKey: string;
    subject: string;
    body: string;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.customerNotice.findUnique({
    where: { dedupeKey: input.dedupeKey },
    select: { id: true, status: true },
  });
  if (existing) {
    // Auto-renew turned off and back on in the same term: the withdrawn notice is needed again
    // (same saved wording). A notice already delivered stays delivered.
    if (existing.status === "NOT_NEEDED") {
      await tx.customerNotice.update({ where: { id: existing.id }, data: { status: "PENDING" } });
      return { id: existing.id, created: true };
    }
    return { id: existing.id, created: false };
  }
  const created = await tx.customerNotice.create({ data: input, select: { id: true } });
  return { id: created.id, created: true };
}

export type NoticeSendResult = { sent: number; stillWaiting: number };

/**
 * A claim older than this means the run died mid-send. We do NOT send it again by ourselves: the email provider may
 * already have accepted it (a second email, or a delivery date that no longer fits the 25-40 day window). It is shown to the
 * owner as "may already have been sent" so a person decides.
 */
const CLAIM_STALE_MINUTES = 15;

/** A renewal reminder is only worth sending while the automatic renewal it warns about is still waiting. */
type NoticeNeed = "GONE" | "OUT_OF_WINDOW" | "OK";

async function noticeNeed(noticeId: string, now: Date): Promise<NoticeNeed> {
  const notice = await prisma.customerNotice.findUnique({ where: { id: noticeId }, select: { kind: true, agreementId: true } });
  if (!notice) return "GONE";
  if (notice.kind !== "RENEWAL_REMINDER" || !notice.agreementId) return "OK";
  const renewal = await prisma.rentalAgreement.findFirst({
    where: { renewedFromAgreementId: notice.agreementId, createdByAutoRenew: true, status: "SCHEDULED" },
    select: { startDate: true },
  });
  if (!renewal?.startDate) return "GONE";
  // Sending a reminder that can no longer be delivered 25 to 40 days ahead would promise a renewal the
  // system will not start. It stays on the owner's list instead.
  const daysBefore = businessDaysBetween(now, renewal.startDate);
  return daysBefore >= REMINDER_MIN_DAYS_BEFORE && daysBefore <= REMINDER_MAX_DAYS_BEFORE ? "OK" : "OUT_OF_WINDOW";
}

/**
 * Try to email every waiting notice. Each notice is claimed (PENDING -> SENDING) in one
 * atomic step BEFORE the provider is contacted, so the nightly job and the owner's "mark
 * delivered" can never both deliver it. Email being off leaves them waiting; a failure on
 * one never blocks the rest.
 */
export async function sendPendingNotices(now = new Date()): Promise<NoticeSendResult> {
  const waiting = await prisma.customerNotice.findMany({
    where: { status: "PENDING" },
    // Least recently tried first: a notice that keeps failing goes to the back (its updatedAt moves forward each
    // try), so 200 permanently failing notices can never starve a newer one.
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take: 200,
    select: {
      id: true,
      status: true,
      updatedAt: true,
      subject: true,
      body: true,
      customer: { select: { user: { select: { email: true } } } },
    },
  });
  let sent = 0;
  let stillWaiting = 0;
  for (const notice of waiting) {
    const claimed = await prisma.customerNotice.updateMany({
      where: { id: notice.id, status: notice.status, updatedAt: notice.updatedAt },
      data: { status: "SENDING", attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue; // someone else (or the owner) got there first
    const need = await noticeNeed(notice.id, now);
    if (need === "GONE") {
      await prisma.customerNotice.updateMany({ where: { id: notice.id, status: "SENDING" }, data: { status: "NOT_NEEDED" } });
      continue;
    }
    if (need === "OUT_OF_WINDOW") {
      await prisma.customerNotice.updateMany({
        where: { id: notice.id, status: "SENDING" },
        data: { status: "PENDING", attempts: { decrement: 1 } },
      });
      stillWaiting += 1;
      continue;
    }
    try {
      const result = await sendCustomerEmail({
        to: notice.customer.user.email,
        subject: notice.subject,
        text: notice.body,
        idempotencyKey: `customer-notice-${notice.id}`,
      });
      await prisma.customerNotice.updateMany({
        where: { id: notice.id, status: "SENDING" },
        data: result.sent ? { status: "SENT", sentAt: new Date(), sentVia: "EMAIL" } : { status: "PENDING" },
      });
      if (result.sent) sent += 1;
      else stillWaiting += 1;
    } catch (error) {
      stillWaiting += 1;
      await prisma.customerNotice.updateMany({ where: { id: notice.id, status: "SENDING" }, data: { status: "PENDING" } });
      console.error(`Could not send notice ${notice.id}:`, error);
    }
  }
  return { sent, stillWaiting };
}

/** The owner (or an admin) says they delivered this notice another way. Recorded with who and when. */
export async function markNoticeDeliveredByHand(
  userId: string,
  noticeId: string,
  how: string,
  deliveredOn?: Date,
): Promise<void> {
  const cleaned = how.trim();
  if (cleaned.length < 2) throw new Error("Say how you delivered it (for example “phoned”, “mailed”, “in person”).");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const rows = await tx.$queryRaw<Array<{ status: string; updatedAt: Date }>>`
      SELECT "status", "updatedAt" FROM "CustomerNotice" WHERE "id" = ${noticeId} FOR UPDATE
    `;
    const row = rows[0];
    if (!row) throw new Error("Couldn't find that notice.");
    const interrupted = row.status === "SENDING" && isInterruptedSend(row.updatedAt);
    if (row.status !== "PENDING" && !interrupted) throw new Error("That notice is not waiting to be sent.");
    const now = new Date();
    const when = deliveredOn ?? now;
    if (when.getTime() > now.getTime()) throw new Error("The delivery date can't be in the future.");
    await tx.customerNotice.update({
      where: { id: noticeId },
      data: { status: "SENT", sentAt: when, sentVia: `HAND: ${cleaned.slice(0, 80)}`, sentByUserId: userId },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "notice.marked_delivered",
        entityType: "CustomerNotice",
        entityId: noticeId,
        newValue: { how: cleaned.slice(0, 80) },
      },
    });
  });
}

function isInterruptedSend(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > CLAIM_STALE_MINUTES * 60_000;
}

/** Notices waiting for the owner: not yet sent, or a send that was interrupted and may already have gone out. */
export async function listWaitingNotices() {
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MINUTES * 60_000);
  return prisma.customerNotice.findMany({
    where: { OR: [{ status: "PENDING" }, { status: "SENDING", updatedAt: { lt: staleBefore } }] },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      status: true,
      subject: true,
      body: true,
      createdAt: true,
      agreementId: true,
      customer: { select: { user: { select: { name: true, email: true } } } },
    },
  });
}

/** Colorado asks for the reminder 25 to 40 days before the renewal (a statute, not a business setting). */
export const REMINDER_MIN_DAYS_BEFORE = 25;
export const REMINDER_MAX_DAYS_BEFORE = 40;

export type ReminderCheck = "OK" | "NOT_DELIVERED" | "OUT_OF_WINDOW";

/** Was the reminder delivered, and inside the 25-40 day window before the renewal starts? */
export async function checkReminderDelivered(
  tx: Pick<Prisma.TransactionClient, "customerNotice">,
  dedupeKey: string,
  renewalStart: Date,
): Promise<ReminderCheck> {
  const notice = await tx.customerNotice.findUnique({ where: { dedupeKey }, select: { status: true, sentAt: true } });
  if (notice?.status !== "SENT" || !notice.sentAt) return "NOT_DELIVERED";
  const daysBefore = businessDaysBetween(notice.sentAt, renewalStart);
  return daysBefore >= REMINDER_MIN_DAYS_BEFORE && daysBefore <= REMINDER_MAX_DAYS_BEFORE ? "OK" : "OUT_OF_WINDOW";
}
