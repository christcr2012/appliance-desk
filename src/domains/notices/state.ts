import { addBusinessDays, businessEndOfDay } from "@/lib/business-date";

/**
 * Pure rules for customer notices (no database). The lifecycle and the only allowed
 * transitions are in docs/designs/BATCH-B2.md section 4; this file holds the date rules.
 */

export type NoticeStatus = "PENDING" | "SENDING" | "SENT" | "UNCERTAIN" | "MISSED" | "FAILED" | "NOT_NEEDED";
export type NoticeKind = "RENEWAL_REMINDER" | "ANNUAL_REMINDER" | "TERMS_CHANGE";
export type DeliveryChannel = "EMAIL" | "MAIL" | "BUSINESS_MAILBOX" | "IN_PERSON_WRITTEN" | "TEXT_OR_APP";

/** The channels an owner may record by hand. A phone call is deliberately not on the list. */
export const HAND_DELIVERY_CHANNELS = ["MAIL", "BUSINESS_MAILBOX", "IN_PERSON_WRITTEN", "TEXT_OR_APP"] as const;

/** A third refusal from the email service makes the notice FAILED (a person must look). */
export const NOTICE_MAX_REJECTIONS = 3;
/** The email service remembers a request's idempotency key for 24 hours; stay safely inside it. */
export const NOTICE_UNCERTAIN_RETRY_HOURS = 23;
/** A claim older than this means the run that took it died mid-send. */
export const NOTICE_STALE_CLAIM_MINUTES = 15;
/** Colorado asks for the reminder 25 to 40 days before the renewal (a statute, not a business setting). */
export const REMINDER_MIN_DAYS_BEFORE = 25;
export const REMINDER_MAX_DAYS_BEFORE = 40;

export type NoticeWindowState = "TOO_EARLY" | "OPEN" | "PAST_DEADLINE";

/** Where "now" sits against a notice's first and last allowed moment. No window means always open. */
export function noticeWindowState(
  n: { earliestAt: Date | null; deadlineAt: Date | null },
  now: Date,
): NoticeWindowState {
  if (n.deadlineAt && now.getTime() > n.deadlineAt.getTime()) return "PAST_DEADLINE";
  if (n.earliestAt && now.getTime() < n.earliestAt.getTime()) return "TOO_EARLY";
  return "OPEN";
}

/**
 * The days a renewal reminder may reach the customer: from the Colorado midnight 40 days before the
 * renewal starts, to the last second of the Colorado day 25 days before it starts.
 */
export function windowForRenewalStart(start: Date): { earliestAt: Date; deadlineAt: Date } {
  return {
    earliestAt: addBusinessDays(start, -REMINDER_MAX_DAYS_BEFORE),
    deadlineAt: businessEndOfDay(addBusinessDays(start, -REMINDER_MIN_DAYS_BEFORE)),
  };
}

/**
 * The date that counts for the legal window. Email: the provider's acceptance time (pass it as `date`).
 * Mail: the mailing date plus the owner's mail-transit days. Everything else: the date given.
 */
export function evidenceDateFor(input: { channel: DeliveryChannel; date: Date; mailTransitDays: number }): Date {
  if (input.channel !== "MAIL") return input.date;
  return addBusinessDays(input.date, Math.max(0, Math.trunc(input.mailTransitDays)));
}

/** Is an evidence date inside the notice's window? A notice with no window is always inside. */
export function evidenceInsideWindow(
  n: { earliestAt: Date | null; deadlineAt: Date | null },
  evidenceDate: Date,
): boolean {
  return noticeWindowState(n, evidenceDate) === "OPEN";
}
