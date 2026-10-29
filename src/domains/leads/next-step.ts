import { addBusinessDays, businessDateKey, formatShortDate, relativeBusinessDay } from "@/lib/business-date";
import type { LeadStage } from "./stage";

export type LeadNextStepTone = "attention" | "info" | "neutral" | "good";

export type LeadNextStep = { text: string; tone: LeadNextStepTone };

/** The lead fields the next-step line reads. Structural, so the queue row and the full lead both fit. */
export type LeadNextStepInput = {
  stage: LeadStage;
  createdAt: Date;
  nextFollowUpOn: Date | null;
  openQuote: { status: string; sentAt: Date | null; viewedAt: Date | null } | null;
  lostReason?: string | null;
  /** The business's lead response-days target (BusinessSettings.leadResponseDays). */
  responseDays: number;
};

function relativeAge(createdAt: Date, now: Date): string {
  const minutes = Math.max(1, Math.floor((now.getTime() - createdAt.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

function denverDayNumber(date: Date): number {
  const key = businessDateKey(date); // YYYY-MM-DD in America/Denver
  return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / 86400000;
}

/**
 * LEADS.md section 2: the one next-step line for a lead — first match wins, in
 * the spec table's order. Won/lost are checked right after new: they are
 * terminal (the domain clears the follow-up date when a lead is lost, and a
 * converted lead's work is done), so in practice the orders never disagree.
 * Pure: the caller supplies `now` and the response-days target.
 */
export function leadNextStep(row: LeadNextStepInput, now: Date): LeadNextStep {
  if (row.stage === "new") {
    const pastTarget = addBusinessDays(row.createdAt, row.responseDays) < now;
    return { text: `Call — waiting ${relativeAge(row.createdAt, now)}`, tone: pastTarget ? "attention" : "info" };
  }
  if (row.stage === "won") return { text: "Became a customer", tone: "good" };
  if (row.stage === "lost") {
    const reason = row.lostReason?.trim();
    return { text: reason ? reason.slice(0, 60) : "Set a follow-up date", tone: "neutral" };
  }

  if (row.nextFollowUpOn) {
    const followDay = denverDayNumber(row.nextFollowUpOn);
    const today = denverDayNumber(now);
    if (followDay < today) {
      const n = today - followDay;
      return { text: `Follow up — ${n} ${n === 1 ? "day" : "days"} overdue`, tone: "attention" };
    }
    if (followDay === today) return { text: "Follow up today", tone: "info" };
  }

  if (row.stage === "quoted" && row.openQuote) {
    if (row.openQuote.viewedAt) {
      return { text: `Quote viewed ${relativeBusinessDay(row.openQuote.viewedAt, now)} — follow up`, tone: "info" };
    }
    if (row.openQuote.sentAt) {
      return { text: `Quote sent ${relativeBusinessDay(row.openQuote.sentAt, now)}`, tone: "neutral" };
    }
  }

  if (row.nextFollowUpOn) {
    return { text: `Follow up ${formatShortDate(row.nextFollowUpOn, now)}`, tone: "neutral" };
  }

  return { text: "Set a follow-up date", tone: "neutral" };
}
