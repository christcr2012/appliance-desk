import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";
import { sendCustomerEmail } from "@/lib/customer-email";
import { getEmailAcceptedAt } from "@/lib/email";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { isAutoRenewEnabled } from "@/domains/settings/auto-renew-switch";
import { businessDateFromKey, businessDateKey, businessDaysBetween } from "@/lib/business-date";
import {
  NOTICE_MAX_REJECTIONS,
  NOTICE_STALE_CLAIM_MINUTES,
  NOTICE_UNCERTAIN_RETRY_HOURS,
  REMINDER_MAX_DAYS_BEFORE,
  REMINDER_MIN_DAYS_BEFORE,
  HAND_DELIVERY_CHANNELS,
  evidenceDateFor,
  noticeWindowState,
  windowForRenewalStart,
  type NoticeKind as StateNoticeKind,
} from "./state";

export { REMINDER_MAX_DAYS_BEFORE, REMINDER_MIN_DAYS_BEFORE };

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

export type NoticeKind = StateNoticeKind;

export async function createNoticeInTx(
  tx: Prisma.TransactionClient,
  input: {
    customerId: string;
    agreementId: string | null;
    kind: NoticeKind;
    dedupeKey: string;
    subject: string;
    body: string;
    /** The first and last moment the notice may be sent. Empty means no limit. */
    earliestAt?: Date | null;
    deadlineAt?: Date | null;
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
      await tx.customerNotice.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          attempts: 0,
          nextAttemptAt: null,
          claimToken: null,
          lastError: null,
          ...(input.earliestAt !== undefined ? { earliestAt: input.earliestAt } : {}),
          ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
        },
      });
      return { id: existing.id, created: true };
    }
    return { id: existing.id, created: false };
  }
  const created = await tx.customerNotice.create({
    data: {
      customerId: input.customerId,
      agreementId: input.agreementId,
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      subject: input.subject,
      body: input.body,
      earliestAt: input.earliestAt ?? null,
      deadlineAt: input.deadlineAt ?? null,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

export type NoticeSendResult = { sent: number; stillWaiting: number; missed: number; uncertain: number; failed: number };

const ONE_DAY_MS = 24 * 60 * 60_000;
const SEND_BATCH_SIZE = 50;

type NoticeRow = {
  id: string;
  kind: string;
  agreementId: string | null;
  subject: string;
  body: string;
  status: string;
  updatedAt: Date;
  attempts: number;
  earliestAt: Date | null;
  deadlineAt: Date | null;
  sentToAddress: string | null;
  lastAttemptAt: Date | null;
  customer: { user: { email: string } };
};

const NOTICE_SELECT = {
  id: true,
  kind: true,
  agreementId: true,
  subject: true,
  body: true,
  status: true,
  updatedAt: true,
  attempts: true,
  earliestAt: true,
  deadlineAt: true,
  sentToAddress: true,
  lastAttemptAt: true,
  customer: { select: { user: { select: { email: true } } } },
} as const;

/** A renewal reminder is only worth sending while the automatic renewal it warns about is still waiting. */
type NoticeNeed = "GONE" | "PAUSED" | "OK";

/**
 * Whether the notice is still needed, and the window it may be sent in. A reminder saved before windows were
 * stored gets its window from the renewal's start date.
 */
async function noticeNeedAndWindow(
  notice: Pick<NoticeRow, "kind" | "agreementId" | "earliestAt" | "deadlineAt">,
): Promise<{ need: NoticeNeed; window: { earliestAt: Date | null; deadlineAt: Date | null } }> {
  const stored = { earliestAt: notice.earliestAt, deadlineAt: notice.deadlineAt };
  if (notice.kind !== "RENEWAL_REMINDER" || !notice.agreementId) return { need: "OK", window: stored };
  const renewal = await prisma.rentalAgreement.findFirst({
    where: { renewedFromAgreementId: notice.agreementId, createdByAutoRenew: true, status: "SCHEDULED" },
    select: { startDate: true },
  });
  if (!renewal?.startDate) return { need: "GONE", window: stored };
  const window = notice.earliestAt || notice.deadlineAt ? stored : windowForRenewalStart(renewal.startDate);
  // The owner switched automatic renewals off: do not promise a renewal that will not happen.
  if (!(await isAutoRenewEnabled())) return { need: "PAUSED", window };
  return { need: "OK", window };
}

type DeliverOutcome = "SENT" | "WAITING" | "REJECTED" | "FAILED" | "UNCERTAIN" | "TAKEN_OVER";

/**
 * Send one claimed notice and record what really happened, only if this attempt's token still owns the claim.
 * An unclear answer is retried once, immediately, with the identical request and key (the email service returns the
 * original answer for a repeated key, so a second email cannot go out).
 */
async function deliverClaimedNotice(
  notice: Pick<NoticeRow, "id" | "subject" | "body" | "attempts">,
  to: string,
  token: string,
  now: Date,
): Promise<DeliverOutcome> {
  const owned = { id: notice.id, status: "SENDING", claimToken: token } as const;
  const send = () =>
    sendCustomerEmail({
      to,
      subject: notice.subject,
      text: notice.body,
      idempotencyKey: `customer-notice-${notice.id}`,
    });

  let result: Awaited<ReturnType<typeof sendCustomerEmail>>;
  try {
    result = await send();
    if (result.outcome === "UNKNOWN") result = await send();
  } catch (error) {
    // The email service call itself never throws (it reports UNKNOWN instead), so this is a failure before any
    // send, such as reading the owner's switch: nothing went out and it is safe to try again later.
    await prisma.customerNotice.updateMany({ where: owned, data: { status: "PENDING", claimToken: null } });
    console.error(`Could not send notice ${notice.id}:`, error);
    return "WAITING";
  }

  if (result.outcome === "UNKNOWN") {
    const marked = await prisma.customerNotice.updateMany({
      where: owned,
      data: {
        status: "UNCERTAIN",
        claimToken: null,
        lastError: "The email service gave no clear answer twice. It may already have been sent.",
      },
    });
    return marked.count === 1 ? "UNCERTAIN" : "TAKEN_OVER";
  }

  if (result.sent) {
    const providerMessageId = result.providerMessageId ?? null;
    const accepted = (providerMessageId ? await getEmailAcceptedAt(providerMessageId) : null) ?? new Date();
    try {
      const done = await prisma.customerNotice.updateMany({
        where: owned,
        data: {
          status: "SENT",
          sentAt: accepted,
          sentVia: "EMAIL",
          deliveryChannel: "EMAIL",
          providerMessageId,
          acceptedAt: accepted,
          evidenceDate: accepted,
          claimToken: null,
          lastError: null,
        },
      });
      return done.count === 1 ? "SENT" : "TAKEN_OVER";
    } catch (error) {
      // The provider accepted it but we could not save that: leave it "sending". The nightly pass retries the same
      // key, the email service answers with the original acceptance, and no second email goes out.
      console.error(`Notice ${notice.id} was sent but could not be recorded:`, error);
      return "SENT";
    }
  }

  if (result.outcome === "REJECTED") {
    const rejections = notice.attempts + 1;
    const failed = rejections >= NOTICE_MAX_REJECTIONS;
    const done = await prisma.customerNotice.updateMany({
      where: owned,
      data: {
        status: failed ? "FAILED" : "PENDING",
        attempts: rejections,
        claimToken: null,
        nextAttemptAt: failed ? null : new Date(now.getTime() + ONE_DAY_MS),
        lastError: "The email service refused this email.",
      },
    });
    if (done.count !== 1) return "TAKEN_OVER";
    return failed ? "FAILED" : "REJECTED";
  }

  // NOT_ATTEMPTED: live customer email is off (or this is a preview). Nothing was sent; it keeps waiting.
  await prisma.customerNotice.updateMany({ where: owned, data: { status: "PENDING", claimToken: null } });
  return "WAITING";
}

/**
 * A claim left SENDING by a run that died. Under 15 minutes old it may still be running: leave it. Between 15 minutes
 * and 23 hours it is retried with the identical request and key (the email service remembers the key for 24 hours, so
 * this cannot create a second email). Older than 23 hours we can no longer prove that, so a person must look.
 */
async function sweepStaleClaims(now: Date, tally: NoticeSendResult): Promise<void> {
  const stale = await prisma.customerNotice.findMany({
    where: { status: "SENDING" },
    orderBy: { updatedAt: "asc" },
    take: SEND_BATCH_SIZE,
    select: { ...NOTICE_SELECT, claimToken: true },
  });
  for (const notice of stale) {
    const claimedAt = notice.lastAttemptAt ?? notice.updatedAt;
    const age = now.getTime() - claimedAt.getTime();
    if (age < NOTICE_STALE_CLAIM_MINUTES * 60_000) continue;
    if (age >= NOTICE_UNCERTAIN_RETRY_HOURS * 3_600_000) {
      const marked = await prisma.customerNotice.updateMany({
        where: { id: notice.id, status: "SENDING", claimToken: notice.claimToken },
        data: {
          status: "UNCERTAIN",
          claimToken: null,
          lastError: "A send was interrupted more than 23 hours ago. It may already have gone out.",
        },
      });
      if (marked.count === 1) tally.uncertain += 1;
      continue;
    }
    const token = randomUUID();
    const taken = await prisma.customerNotice.updateMany({
      where: { id: notice.id, status: "SENDING", claimToken: notice.claimToken },
      data: { claimToken: token },
    });
    if (taken.count !== 1) continue;
    const outcome = await deliverClaimedNotice(notice, notice.sentToAddress ?? notice.customer.user.email, token, now);
    if (outcome === "SENT") tally.sent += 1;
    else if (outcome === "UNCERTAIN") tally.uncertain += 1;
    else if (outcome === "FAILED") tally.failed += 1;
    else tally.stillWaiting += 1;
  }
}

/**
 * Try to email every notice that is due. Each notice is claimed (PENDING -> SENDING, with a random token) in one
 * atomic step BEFORE the provider is contacted, so the nightly job and an owner's hand delivery can never both deliver
 * it, and a late answer from a stale worker is ignored. A notice is never sent before its first allowed day, and once
 * its last allowed day has passed it becomes MISSED and is never sent. At most 50 per run, earliest deadline first.
 */
export async function sendPendingNotices(now = new Date()): Promise<NoticeSendResult> {
  const tally: NoticeSendResult = { sent: 0, stillWaiting: 0, missed: 0, uncertain: 0, failed: 0 };
  await sweepStaleClaims(now, tally);

  const due = await prisma.customerNotice.findMany({
    where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    orderBy: [{ deadlineAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: SEND_BATCH_SIZE,
    select: NOTICE_SELECT,
  });
  for (const notice of due) {
    const { need, window } = await noticeNeedAndWindow(notice);
    if (need === "GONE") {
      await prisma.customerNotice.updateMany({ where: { id: notice.id, status: "PENDING" }, data: { status: "NOT_NEEDED" } });
      continue;
    }
    const windowState = noticeWindowState(window, now);
    if (windowState === "PAST_DEADLINE") {
      // Never send a stale promise. A person decides what happens next (Today -> "Fix a missed reminder").
      const marked = await prisma.customerNotice.updateMany({
        where: { id: notice.id, status: "PENDING" },
        data: {
          status: "MISSED",
          lastError: "The last day to send this reminder passed before it was delivered.",
          ...(notice.deadlineAt ? {} : { earliestAt: window.earliestAt, deadlineAt: window.deadlineAt }),
        },
      });
      if (marked.count === 1) tally.missed += 1;
      continue;
    }
    if (windowState === "TOO_EARLY" || need === "PAUSED") {
      tally.stillWaiting += 1;
      continue;
    }

    const token = randomUUID();
    const address = notice.sentToAddress ?? notice.customer.user.email;
    const claimed = await prisma.customerNotice.updateMany({
      where: { id: notice.id, status: "PENDING", updatedAt: notice.updatedAt },
      data: {
        status: "SENDING",
        claimToken: token,
        lastAttemptAt: now,
        // The address is frozen at the first claim, so a later change to the customer's email cannot redirect it.
        sentToAddress: address,
        ...(notice.deadlineAt ? {} : { earliestAt: window.earliestAt, deadlineAt: window.deadlineAt }),
      },
    });
    if (claimed.count !== 1) continue; // someone else (or the owner) got there first

    const outcome = await deliverClaimedNotice(notice, address, token, now);
    if (outcome === "SENT") tally.sent += 1;
    else if (outcome === "UNCERTAIN") tally.uncertain += 1;
    else if (outcome === "FAILED") tally.failed += 1;
    else if (outcome === "WAITING" || outcome === "REJECTED") tally.stillWaiting += 1;
  }
  return tally;
}

/** Who may record a delivery: the owner only (starting value) or owner and admins. An owner setting. */
async function certifierRoles(tx: Prisma.TransactionClient): Promise<Array<"OWNER" | "ADMIN">> {
  const settings = await tx.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { noticeCertifierRoles: true },
  });
  return settings?.noticeCertifierRoles === "OWNER_AND_ADMIN" ? ["OWNER", "ADMIN"] : ["OWNER"];
}

function parsePastBusinessDate(key: string, label: string, now: Date): Date {
  const day = businessDateFromKey(key);
  if (!day) throw new Error(`Enter ${label} as a real date.`);
  if (businessDateKey(day) > businessDateKey(now)) throw new Error(`${label[0]!.toUpperCase()}${label.slice(1)} can't be in the future.`);
  return day;
}

async function lockNotice(tx: Prisma.TransactionClient, noticeId: string) {
  const rows = await tx.$queryRaw<Array<{ status: string; updatedAt: Date; deadlineAt: Date | null; earliestAt: Date | null; customerId: string }>>`
    SELECT "status", "updatedAt", "deadlineAt", "earliestAt", "customerId" FROM "CustomerNotice" WHERE "id" = ${noticeId} FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new Error("Couldn't find that notice.");
  return row;
}

export type HandDeliveryInput = {
  channel: (typeof HAND_DELIVERY_CHANNELS)[number];
  /** YYYY-MM-DD, Colorado; not in the future. */
  date: string;
  /** The address, email or number used (2 to 200 characters). */
  sentTo: string;
  /** What the owner did and how they know (2 to 500 characters). */
  note: string;
};

/**
 * The owner says they delivered this notice by a real channel (mail, the business mailbox, a printed copy handed over,
 * or a text to a customer who opted in). A phone call is not a delivery. The date that counts for the legal window is
 * the evidence date (mail adds the owner's transit days). The record is permanent: a mistake is corrected with an
 * audited owner note, never by editing the date.
 */
export async function recordNoticeDelivery(userId: string, noticeId: string, input: HandDeliveryInput): Promise<void> {
  if (!(HAND_DELIVERY_CHANNELS as readonly string[]).includes(input.channel)) {
    throw new Error("Choose how it was delivered. A phone call is not a delivery.");
  }
  const sentTo = input.sentTo.trim();
  const note = input.note.trim();
  if (sentTo.length < 2 || sentTo.length > 200) throw new Error("Say which address, email or number it went to (2 to 200 characters).");
  if (note.length < 2 || note.length > 500) throw new Error("Add a short note on how you know it was delivered (2 to 500 characters).");
  const now = new Date();
  const date = parsePastBusinessDate(input.date, "the delivery date", now);

  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, await certifierRoles(tx));
    const row = await lockNotice(tx, noticeId);
    if (!["PENDING", "UNCERTAIN", "FAILED", "MISSED"].includes(row.status)) {
      throw new Error("That notice is not waiting for a delivery record.");
    }
    if (input.channel === "TEXT_OR_APP") {
      const customer = await tx.customer.findUnique({ where: { id: row.customerId }, select: { smsOptInAt: true } });
      if (!customer?.smsOptInAt) throw new Error("This customer has not agreed to receive texts, so a text is not a valid delivery.");
    }
    const settings = await tx.businessSettings.findUnique({ where: { id: "singleton" }, select: { mailNoticeTransitDays: true } });
    const transit = settings?.mailNoticeTransitDays ?? 3;
    const evidenceDate = evidenceDateFor({ channel: input.channel, date, mailTransitDays: transit });
    await tx.customerNotice.update({
      where: { id: noticeId },
      data: {
        status: "SENT",
        sentAt: date,
        sentVia: `HAND: ${input.channel}`,
        sentByUserId: userId,
        deliveryChannel: input.channel,
        evidenceDate,
        claimToken: null,
        lastError: null,
        deliveryEvidence: { sentTo, note, date: input.date, mailTransitDays: input.channel === "MAIL" ? transit : 0, recordedBy: userId },
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "notice.delivery_recorded",
        entityType: "CustomerNotice",
        entityId: noticeId,
        newValue: { channel: input.channel, date: input.date, evidenceDate: evidenceDate.toISOString(), sentTo, note },
      },
    });
  });
}

/**
 * For a notice the email service may or may not have accepted: the owner checked and says what happened.
 * "It went out" needs the date the email service shows; "it did not" puts it back in line, but only while its
 * last allowed day has not passed.
 */
export async function confirmEmailOutcome(
  userId: string,
  noticeId: string,
  input: { sent: true; acceptedOn: string } | { sent: false },
): Promise<void> {
  const now = new Date();
  const acceptedDay = input.sent ? parsePastBusinessDate(input.acceptedOn, "the date the email service shows", now) : null;
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, input.sent ? await certifierRoles(tx) : ["OWNER", "ADMIN"]);
    const row = await lockNotice(tx, noticeId);
    if (!["UNCERTAIN", "FAILED", ...(input.sent ? ["MISSED"] : [])].includes(row.status)) {
      throw new Error("That notice is not waiting for this answer.");
    }
    if (input.sent) {
      await tx.customerNotice.update({
        where: { id: noticeId },
        data: {
          status: "SENT",
          sentAt: acceptedDay!,
          sentVia: "EMAIL",
          sentByUserId: userId,
          deliveryChannel: "EMAIL",
          evidenceDate: acceptedDay!,
          claimToken: null,
          lastError: null,
          deliveryEvidence: { confirmedByOwner: true, acceptedOn: (input as { acceptedOn: string }).acceptedOn, recordedBy: userId },
        },
      });
    } else {
      if (noticeWindowState(row, now) === "PAST_DEADLINE") {
        throw new Error("The last day to send this reminder has passed, so it can't be sent again. Choose another option.");
      }
      await tx.customerNotice.update({
        where: { id: noticeId },
        data: { status: "PENDING", attempts: 0, nextAttemptAt: null, claimToken: null, lastError: null },
      });
    }
    await tx.auditLog.create({
      data: {
        userId,
        action: input.sent ? "notice.email_confirmed_sent" : "notice.email_confirmed_not_sent",
        entityType: "CustomerNotice",
        entityId: noticeId,
        newValue: input.sent ? { acceptedOn: input.acceptedOn } : {},
      },
    });
  });
}

export type NoticeDeadline = "OK" | "MISSED" | "TOO_EARLY" | "UNKNOWN";

/** Where a waiting renewal reminder stands against the 25 to 40 day window. */
export function reminderDeadlineState(renewalStart: Date | null, now: Date): NoticeDeadline {
  if (!renewalStart) return "UNKNOWN";
  const daysBefore = businessDaysBetween(now, renewalStart);
  if (daysBefore < REMINDER_MIN_DAYS_BEFORE) return "MISSED";
  if (daysBefore > REMINDER_MAX_DAYS_BEFORE) return "TOO_EARLY";
  return "OK";
}

/** Notices that need the owner: waiting to be sent, or one that did not go cleanly (missed, uncertain, failed). */
export async function listWaitingNotices(now = new Date()) {
  const rows = await prisma.customerNotice.findMany({
    where: { status: { in: ["PENDING", "SENDING", "UNCERTAIN", "FAILED", "MISSED"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    select: {
      id: true,
      kind: true,
      status: true,
      subject: true,
      body: true,
      createdAt: true,
      agreementId: true,
      earliestAt: true,
      deadlineAt: true,
      lastError: true,
      customer: { select: { user: { select: { name: true, email: true } } } },
    },
  });
  const result = [];
  for (const row of rows) {
    let deadline: NoticeDeadline = "UNKNOWN";
    if (row.deadlineAt || row.earliestAt) {
      const state = noticeWindowState(row, now);
      deadline = state === "PAST_DEADLINE" ? "MISSED" : state === "TOO_EARLY" ? "TOO_EARLY" : "OK";
    } else if (row.kind === "RENEWAL_REMINDER" && row.agreementId) {
      const renewal = await prisma.rentalAgreement.findFirst({
        where: { renewedFromAgreementId: row.agreementId, createdByAutoRenew: true, status: "SCHEDULED" },
        select: { startDate: true },
      });
      deadline = reminderDeadlineState(renewal?.startDate ?? null, now);
    }
    result.push({ ...row, deadline });
  }
  return result;
}

export type ReminderCheck = "OK" | "NOT_DELIVERED" | "OUT_OF_WINDOW";

/** Was the reminder delivered, and inside the 25-40 day window before the renewal starts? */
export async function checkReminderDelivered(
  tx: Pick<Prisma.TransactionClient, "customerNotice">,
  dedupeKey: string,
  renewalStart: Date,
): Promise<ReminderCheck> {
  const notice = await tx.customerNotice.findUnique({
    where: { dedupeKey },
    select: { status: true, sentAt: true, evidenceDate: true },
  });
  const delivered = notice?.evidenceDate ?? notice?.sentAt;
  if (notice?.status !== "SENT" || !delivered) return "NOT_DELIVERED";
  const daysBefore = businessDaysBetween(delivered, renewalStart);
  return daysBefore >= REMINDER_MIN_DAYS_BEFORE && daysBefore <= REMINDER_MAX_DAYS_BEFORE ? "OK" : "OUT_OF_WINDOW";
}
