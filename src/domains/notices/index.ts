import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { assertActiveTeamActor } from "@/lib/team-actor";

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
  const existing = await tx.customerNotice.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };
  const created = await tx.customerNotice.create({ data: input, select: { id: true } });
  return { id: created.id, created: true };
}

export type NoticeSendResult = { sent: number; stillWaiting: number };

/** Try to email every waiting notice. Email being off leaves them waiting; a failure on one never blocks the rest. */
export async function sendPendingNotices(): Promise<NoticeSendResult> {
  const waiting = await prisma.customerNotice.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      subject: true,
      body: true,
      customer: { select: { user: { select: { email: true } } } },
    },
  });
  let sent = 0;
  let stillWaiting = 0;
  for (const notice of waiting) {
    try {
      const result = await sendEmail({
        to: notice.customer.user.email,
        subject: notice.subject,
        text: notice.body,
        idempotencyKey: `customer-notice-${notice.id}`,
      });
      await prisma.customerNotice.update({
        where: { id: notice.id },
        data: result.sent
          ? { status: "SENT", sentAt: new Date(), sentVia: "EMAIL", attempts: { increment: 1 } }
          : { attempts: { increment: 1 } },
      });
      if (result.sent) sent += 1;
      else stillWaiting += 1;
    } catch (error) {
      stillWaiting += 1;
      console.error(`Could not send notice ${notice.id}:`, error);
    }
  }
  return { sent, stillWaiting };
}

/** The owner (or an admin) says they delivered this notice another way. Recorded with who and when. */
export async function markNoticeDeliveredByHand(userId: string, noticeId: string, how: string): Promise<void> {
  const cleaned = how.trim();
  if (cleaned.length < 2) throw new Error("Say how you delivered it (for example “phoned”, “mailed”, “in person”).");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const rows = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT "status" FROM "CustomerNotice" WHERE "id" = ${noticeId} FOR UPDATE
    `;
    const row = rows[0];
    if (!row) throw new Error("Couldn't find that notice.");
    if (row.status !== "PENDING") throw new Error("That notice is not waiting to be sent.");
    await tx.customerNotice.update({
      where: { id: noticeId },
      data: { status: "SENT", sentAt: new Date(), sentVia: `HAND: ${cleaned.slice(0, 80)}`, sentByUserId: userId },
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

/** A notice that no longer matters (the renewal it warned about was cancelled). Only waiting notices change. */
export async function withdrawWaitingNoticesForAgreement(agreementId: string, kind: NoticeKind): Promise<number> {
  const result = await prisma.customerNotice.updateMany({
    where: { agreementId, kind, status: "PENDING" },
    data: { status: "NOT_NEEDED" },
  });
  return result.count;
}

export async function listWaitingNotices() {
  return prisma.customerNotice.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      subject: true,
      body: true,
      createdAt: true,
      agreementId: true,
      customer: { select: { user: { select: { name: true, email: true } } } },
    },
  });
}

/** Has the reminder for this agreement's renewal been delivered? */
export async function reminderDelivered(tx: Prisma.TransactionClient, dedupeKey: string): Promise<boolean> {
  const notice = await tx.customerNotice.findUnique({ where: { dedupeKey }, select: { status: true } });
  return notice?.status === "SENT";
}
