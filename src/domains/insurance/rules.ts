// OPS-4: pure rules for insurance reminders, workers' compensation and the certificate-of-insurance request.
import { businessDaysBetween } from "@/lib/business-date";

export const KIND_LABELS = {
  GENERAL_LIABILITY: "General liability",
  COMMERCIAL_AUTO: "Commercial auto (delivery vehicle)",
  EQUIPMENT: "Equipment / inland marine (the appliances)",
  WORKERS_COMP: "Workers' compensation",
  OTHER: "Other",
} as const;
export type InsuranceKindValue = keyof typeof KIND_LABELS;
export const INSURANCE_KINDS = Object.keys(KIND_LABELS) as InsuranceKindValue[];

/** Plain words for what each kind covers. Amounts are always "ask your agent": the app never suggests limits. */
export const KIND_HELP: Record<InsuranceKindValue, string> = {
  GENERAL_LIABILITY: "Covers injuries or damage your business causes, such as an appliance causing a flood. Ask your agent what limit fits your rentals.",
  COMMERCIAL_AUTO: "Covers the vehicle you deliver with. Personal car insurance usually doesn't cover business deliveries. Colorado's legal minimum for any car is 25/50/15 (C.R.S. 10-4-620); ask your agent what a business needs.",
  EQUIPMENT: "Covers the appliances you own while they are out on rent or in storage (theft, fire, damage). Ask your agent what is covered and the limit.",
  WORKERS_COMP: "Pays medical bills and lost wages when an employee is hurt at work. Colorado requires it once you have employees; an LLC member may be able to opt out for themselves.",
  OTHER: "Anything else your agent set up.",
};

export const REMIND_FIRST_DEFAULT = 60;
export const REMIND_SECOND_DEFAULT = 30;

export function validateReminderDays(first: number, second: number): string | null {
  for (const n of [first, second]) if (!Number.isInteger(n) || n < 1 || n > 365) return "Use whole numbers of days from 1 to 365.";
  if (first <= second) return "The first reminder must come earlier (more days before) than the second.";
  return null;
}

export type RenewalState = { kind: "ok"; daysLeft: number } | { kind: "first"; daysLeft: number } | { kind: "second"; daysLeft: number } | { kind: "expired"; daysOver: number };

export function renewalState(expiresOn: Date, now: Date, firstDays: number, secondDays: number): RenewalState {
  const daysLeft = businessDaysBetween(now, expiresOn);
  if (daysLeft < 0) return { kind: "expired", daysOver: -daysLeft };
  if (daysLeft <= secondDays) return { kind: "second", daysLeft };
  if (daysLeft <= firstDays) return { kind: "first", daysLeft };
  return { kind: "ok", daysLeft };
}

export type WorkersCompStatusValue = "NOT_SET" | "NO_EMPLOYEES_REJECTED" | "POLICY_IN_PLACE";

/** True while the business has employees but no workers' compensation policy recorded as in place. */
export function workersCompRequiredNow(status: WorkersCompStatusValue, employees: number, hasActiveWorkersCompPolicy: boolean): boolean {
  if (employees <= 0) return false;
  return status !== "POLICY_IN_PLACE" || !hasActiveWorkersCompPolicy;
}

export function workersCompSummary(s: { status: WorkersCompStatusValue; note: string | null; formSentOnText?: string | null; mailNumber?: string | null }): string {
  if (s.status === "POLICY_IN_PLACE") return "A workers' compensation policy is in place" + (s.note ? ` (${s.note})` : "") + ".";
  if (s.status === "NO_EMPLOYEES_REJECTED") {
    const sent = s.formSentOnText ? `rejection form sent ${s.formSentOnText}` : "rejection form not yet recorded";
    return `No employees. Coverage rejected as an LLC member (${sent}${s.mailNumber ? `, certified mail ${s.mailNumber}` : ""}).`;
  }
  return "Not recorded yet.";
}

export type PolicyInput = {
  kind: InsuranceKindValue; insurer: string; policyNumber: string; limitsText?: string; annualPremiumCents?: number | null;
  effectiveOnKey?: string; expiresOnKey: string; agentName?: string; agentEmail?: string; certificateNote?: string; notes?: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkPolicyInput(input: PolicyInput): { problem: string | null; clean: PolicyInput } {
  const t = (v: string | undefined, max = 300) => (v ?? "").trim().slice(0, max);
  const clean: PolicyInput = {
    kind: input.kind, insurer: t(input.insurer, 120), policyNumber: t(input.policyNumber, 80), limitsText: t(input.limitsText, 400) || undefined,
    annualPremiumCents: input.annualPremiumCents ?? null, effectiveOnKey: input.effectiveOnKey || undefined, expiresOnKey: input.expiresOnKey,
    agentName: t(input.agentName, 120) || undefined, agentEmail: t(input.agentEmail, 160) || undefined,
    certificateNote: t(input.certificateNote, 300) || undefined, notes: t(input.notes, 600) || undefined,
  };
  if (!INSURANCE_KINDS.includes(clean.kind)) return { problem: "Choose what kind of insurance this is.", clean };
  if (!clean.insurer) return { problem: "Enter the insurance company.", clean };
  if (!clean.policyNumber) return { problem: "Enter the policy number.", clean };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean.expiresOnKey)) return { problem: "Pick the date this policy ends.", clean };
  if (clean.effectiveOnKey && !/^\d{4}-\d{2}-\d{2}$/.test(clean.effectiveOnKey)) return { problem: "Pick a real start date, or leave it empty.", clean };
  if (clean.effectiveOnKey && clean.effectiveOnKey > clean.expiresOnKey) return { problem: "The start date must be before the end date.", clean };
  if (clean.annualPremiumCents != null && (!Number.isInteger(clean.annualPremiumCents) || clean.annualPremiumCents < 0 || clean.annualPremiumCents > 100_000_000)) return { problem: "Enter the yearly cost in dollars, or leave it empty.", clean };
  if (clean.agentEmail && !EMAIL.test(clean.agentEmail)) return { problem: "That agent email doesn't look right.", clean };
  return { problem: null, clean };
}

export type CertificateRequestInput = { requesterName: string; requesterCompany?: string; requesterEmail: string; holderText?: string };

export function checkCertificateRequest(input: CertificateRequestInput): string | null {
  if (!input.requesterName.trim()) return "Enter who is asking for the certificate.";
  if (!EMAIL.test(input.requesterEmail.trim())) return "Enter the email address the certificate should be sent to.";
  return null;
}

/** The email Chris sends to his agent. The app only drafts it: it opens in his own mail program. */
export function certificateEmailDraft(f: {
  agentEmail: string; agentName?: string | null; insurer: string; policyNumber: string; kindLabel: string; businessName: string;
  requester: CertificateRequestInput; ownerName: string;
}): { to: string; subject: string; body: string; mailto: string } {
  const asker = [f.requester.requesterName.trim(), f.requester.requesterCompany?.trim()].filter(Boolean).join(", ");
  const subject = `Certificate of insurance request - ${f.businessName}`;
  const body = [
    `Hello${f.agentName ? ` ${f.agentName}` : ""},`,
    `Please send a certificate of insurance for ${f.businessName} (${f.kindLabel}, ${f.insurer}, policy ${f.policyNumber}) to ${asker} at ${f.requester.requesterEmail.trim()}.`,
    f.requester.holderText?.trim() ? `Certificate holder / additional insured wording they asked for: ${f.requester.holderText.trim()}` : null,
    `Please copy me on the reply.`,
    `Thank you,`,
    f.ownerName,
  ].filter(Boolean).join("\n\n");
  const mailto = `mailto:${encodeURIComponent(f.agentEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { to: f.agentEmail, subject, body, mailto };
}
