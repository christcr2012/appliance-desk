import { businessDateKey } from "@/lib/business-date";

/**
 * OPS-8. The background jobs that START new charges or send reminders to customers. The owner-only
 * "Pause all automatic charges" switch stops exactly these. It never refunds, cancels, or touches money
 * already taken, and the safety jobs (backups, payment reconciling, recall watch, tax watches) keep running.
 */
export const CHARGE_PAUSE_RULE_KEYS = [
  "billing-reminders",
  "late-fees",
  "collections",
  "estimate-follow-ups",
  "job-reminders",
  "launch-emails",
  "billing-reconcile:retail-delivery-fee-charges",
  "start-renewals:auto-renewals",
  "start-renewals:annual-reminders",
  "start-renewals:pending-notices",
  "start-renewals:billing-extensions",
] as const;

export function pausedByChargeSwitch(ruleKey: string): boolean {
  return (CHARGE_PAUSE_RULE_KEYS as readonly string[]).includes(ruleKey);
}

export const PAUSE_NOTE_MAX = 300;
export const PROFILE_TEXT_MAX = 300;

export const PROFILE_FIELDS = [
  { key: "continuityEmergencyName", label: "Emergency contact — name", group: "emergency" },
  { key: "continuityEmergencyContact", label: "Emergency contact — phone or email", group: "emergency" },
  { key: "continuitySuccessorName", label: "Who keeps the business running — name", group: "successor" },
  { key: "continuitySuccessorContact", label: "Who keeps the business running — phone or email", group: "successor" },
  { key: "continuityCpaName", label: "Your CPA (accountant) — name", group: "cpa" },
  { key: "continuityCpaContact", label: "Your CPA — phone or email", group: "cpa" },
  { key: "continuityAttorneyName", label: "Your attorney — name", group: "attorney" },
  { key: "continuityAttorneyContact", label: "Your attorney — phone or email", group: "attorney" },
  { key: "continuityRecordsNote", label: "Where your records and passwords are kept", group: "records" },
] as const;
export type ProfileKey = (typeof PROFILE_FIELDS)[number]["key"];

/** Trim, collapse empty to null, and refuse anything longer than the limit (no silent cutting). */
export function cleanProfile(input: Partial<Record<ProfileKey, string | null | undefined>>): Record<ProfileKey, string | null> {
  const out = {} as Record<ProfileKey, string | null>;
  for (const field of PROFILE_FIELDS) {
    const value = (input[field.key] ?? "").replace(/\s+/g, " ").trim();
    if (value.length > PROFILE_TEXT_MAX) throw new Error(`"${field.label}" is too long (most ${PROFILE_TEXT_MAX} characters).`);
    out[field.key] = value || null;
  }
  return out;
}

/** Plain-words gaps the "If I'm gone" page should point at, so a blank page never looks finished. */
export function profileGaps(profile: Partial<Record<ProfileKey, string | null>>): string[] {
  const gaps: string[] = [];
  if (!profile.continuityEmergencyName || !profile.continuityEmergencyContact) gaps.push("an emergency contact");
  if (!profile.continuitySuccessorName || !profile.continuitySuccessorContact) gaps.push("the person who would keep the business running");
  if (!profile.continuityCpaName || !profile.continuityCpaContact) gaps.push("your CPA");
  if (!profile.continuityRecordsNote) gaps.push("where your records and passwords are kept");
  return gaps;
}

export type CheckupItem = { key: string; label: string; detail: string; href: string };

/** The December walkthrough. Every item opens a screen that already exists; ticking one only records "I looked". */
export const CHECKUP_ITEMS: readonly CheckupItem[] = [
  { key: "insurance", label: "Insurance limits and renewals", detail: "Do your policies still fit the business, and are any ending soon?", href: "/desk/insurance" },
  { key: "prices", label: "Prices and fees", detail: "Look at monthly prices, delivery and late fees. Change anything for next year.", href: "/desk/settings" },
  { key: "cpa", label: "CPA meeting packet", detail: "Gather this year's books and reports for your accountant.", href: "/desk/books" },
  { key: "policies", label: "Policies and rental terms", detail: "Read your rental agreement wording and policies once more.", href: "/desk/settings" },
  { key: "retention", label: "Old records and the clean-up setting", detail: "See what the records clean-up would remove and whether it is still off.", href: "/desk/privacy-security" },
  { key: "access", label: "Who has access", detail: "Team members, your accountant and any assistants: remove anyone who no longer needs it.", href: "/desk/settings" },
  { key: "vendors", label: "Vendor security terms", detail: "Check the companies that hold your customers' information still meet your standard.", href: "/desk/privacy-security" },
  { key: "recalls", label: "Whole-fleet recall check", detail: "Look through every appliance you own for open recalls.", href: "/desk/recalls" },
  { key: "expiring", label: "Records and permits expiring next year", detail: "Licenses, registrations and policies that end next year.", href: "/desk/paperwork" },
  { key: "taxes", label: "Tax set-aside: planned vs. actual", detail: "Compare what you set aside for taxes this year with what the books show.", href: "/desk/books" },
  { key: "continuity", label: "'If something happens to me' page", detail: "Update the contacts and the notes on where things are kept.", href: "/desk/continuity" },
] as const;

export const CHECKUP_KEYS: readonly string[] = CHECKUP_ITEMS.map((i) => i.key);

/** The business-calendar year (America/Denver) of an instant. */
export function checkupYear(now: Date): number {
  return Number(businessDateKey(now).slice(0, 4));
}

/** The check-up is due all of December until it is finished for that year. */
export function checkupDue(now: Date, completedYears: readonly number[]): { due: boolean; year: number } {
  const key = businessDateKey(now);
  const year = Number(key.slice(0, 4));
  const december = key.slice(5, 7) === "12";
  return { due: december && !completedYears.includes(year), year };
}

/** Keep only known item keys, once each, in menu order. */
export function cleanTicked(keys: readonly string[]): string[] {
  const set = new Set(keys);
  return CHECKUP_KEYS.filter((k) => set.has(k));
}
