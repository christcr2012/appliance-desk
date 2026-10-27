// OPS-7: the plain rules for privacy and security duties. Pure: no database, no network, no clock.
// Facts: docs/research/2026-10-25-operating-risks.md items 3, 10 and 11. Deadlines come from the dated rule book
// (co.breach_*), never from a number typed here.
import { businessMinuteOfDay } from "@/domains/messaging/quiet-hours";

const DAY_MS = 24 * 60 * 60 * 1000;

export const RECOMMENDED_RETENTION = {
  agreementYears: 7,
  taxYears: 7,
  refrigerantYears: 6,
  leadYears: 2,
  messageYears: 3,
} as const;
export const RECOMMENDED_MARKETING_TEXT_HOURS = { start: 8, end: 21 } as const;
export const RECOMMENDED_VENDOR_REVIEW_MONTHS = 12;
/** Most records one nightly purge may remove, so a wrong setting can never empty a table in one night. */
export const PURGE_NIGHTLY_LIMIT = 200;

export type BreachRules = { noticeDays: number; agThreshold: number; bureauThreshold: number };

export type BreachPlan = {
  /** Last day to tell the affected people. */
  residentsBy: Date;
  needsAttorneyGeneral: boolean;
  needsBureaus: boolean;
};

/** The three duties that follow from the date a breach was determined and how many Colorado residents were affected. */
export function breachPlan(determinedAt: Date, residents: number, rules: BreachRules): BreachPlan {
  return {
    residentsBy: new Date(determinedAt.getTime() + rules.noticeDays * DAY_MS),
    needsAttorneyGeneral: residents >= rules.agThreshold,
    needsBureaus: residents > rules.bureauThreshold,
  };
}

export type IncidentSnapshot = {
  determinedAt: Date | null;
  residentsAffected: number | null;
  residentsNotifiedAt: Date | null;
  attorneyGeneralNotifiedAt: Date | null;
  bureausNotifiedAt: Date | null;
  vendorsNotifiedAt: Date | null;
};

export type IncidentStep = { key: "DETERMINE" | "RESIDENTS" | "ATTORNEY_GENERAL" | "BUREAUS" | "VENDORS"; label: string; due: Date | null; done: boolean };

/** Every step still owed for an incident, in the order they should happen. Never late-proof: a due date is fixed once determined. */
export function incidentSteps(incident: IncidentSnapshot, rules: BreachRules): IncidentStep[] {
  if (!incident.determinedAt || incident.residentsAffected === null) {
    return [{ key: "DETERMINE", label: "Decide whether customer information was really exposed, and how many Colorado residents are affected", due: null, done: false }];
  }
  const plan = breachPlan(incident.determinedAt, incident.residentsAffected, rules);
  const steps: IncidentStep[] = [
    { key: "RESIDENTS", label: "Tell the affected people", due: plan.residentsBy, done: incident.residentsNotifiedAt !== null },
  ];
  if (plan.needsAttorneyGeneral) {
    steps.push({ key: "ATTORNEY_GENERAL", label: "Tell the Colorado Attorney General", due: plan.residentsBy, done: incident.attorneyGeneralNotifiedAt !== null });
  }
  if (plan.needsBureaus) {
    steps.push({ key: "BUREAUS", label: "Tell the national credit bureaus", due: plan.residentsBy, done: incident.bureausNotifiedAt !== null });
  }
  steps.push({ key: "VENDORS", label: "Tell the service providers who hold the information", due: null, done: incident.vendorsNotifiedAt !== null });
  return steps;
}

export function yearsAgo(now: Date, years: number): Date {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}

export function clampYears(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(30, Math.max(1, Math.round(value)));
}

export function clampHour(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(23, Math.max(0, Math.round(value)));
}

/** Marketing texts only inside the window (Denver clock). Start equal to end means "never". */
export function marketingTextAllowed(at: Date, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  const minute = businessMinuteOfDay(at);
  const start = startHour * 60;
  const end = endHour * 60;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** A vendor's security terms are due for a re-read when never reviewed or the last review is older than the setting. */
export function vendorReviewDue(reviewedOn: Date | null, now: Date, months: number): boolean {
  if (!reviewedOn) return true;
  const due = new Date(reviewedOn.getTime());
  due.setUTCMonth(due.getUTCMonth() + months);
  return due.getTime() <= now.getTime();
}

export function accessibilityFixBy(receivedAt: Date, fixDays: number): Date {
  return new Date(receivedAt.getTime() + fixDays * DAY_MS);
}

export const FACE_MATCH_POLICY_NOTE =
  "Colorado treats a face scan as a biometric identifier. Leave this off. If you turn it on you must publish a written biometric policy and get each person's consent first.";
