import {
  autoRenewPolicyReady,
  loadTerminationPolicy,
  type AutoRenewPolicySettings,
  type TerminationPolicySettings,
} from "@/domains/agreements/term-policy";
import type { BusinessSettingsUpdate } from "./index";

/**
 * The owner's "Ending and renewing rentals" settings. Everything is typed in
 * ordinary units (dollars, percent, days, plain sentences), converted here,
 * and stored in BusinessSettings. A blank field means "not decided yet" and is
 * saved as null; nothing is ever filled in with a default.
 */

export const TERMS_POLICY_FIELDS = [
  "feeDollars",
  "feePercent",
  "feeCapDollars",
  "noticeDays",
  "unusedTerm",
  "terminationTermsText",
  "autoRenewNoticeDays",
  "renewalTermsText",
] as const;

export type TermsPolicyFormValues = Record<(typeof TERMS_POLICY_FIELDS)[number], string>;

const MAX_TEXT = 5000;

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function text(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "\u0000";
}

function dollarsToCentsOrNull(raw: unknown, label: string): Parsed<number | null> {
  const value = text(raw);
  if (value === "") return { ok: true, value: null };
  const match = /^\$?(\d{1,6})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) {
    return { ok: false, message: `${label}: enter dollars and cents, like 50 or 49.99.` };
  }
  return { ok: true, value: Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) };
}

function wholeNumberOrNull(raw: unknown, label: string, max: number): Parsed<number | null> {
  const value = text(raw);
  if (value === "") return { ok: true, value: null };
  if (!/^\d{1,6}$/.test(value) || Number(value) > max) {
    return { ok: false, message: `${label}: enter a whole number from 0 to ${max}.` };
  }
  return { ok: true, value: Number(value) };
}

function textOrNull(raw: unknown, label: string): Parsed<string | null> {
  const value = text(raw);
  if (value === "") return { ok: true, value: null };
  if (value.includes("\u0000") || value.length > MAX_TEXT) {
    return { ok: false, message: `${label}: keep it under ${MAX_TEXT} characters.` };
  }
  return { ok: true, value };
}

export { autoRenewTermsVersionFor } from "@/domains/agreements/terms-snapshot";
import { autoRenewTermsVersionFor } from "@/domains/agreements/terms-snapshot";

export function termsPolicyUpdate(
  raw: Record<string, unknown>,
): { success: true; update: BusinessSettingsUpdate } | { success: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { success: false, message: "Please check the fields in this section." };
  }
  if (TERMS_POLICY_FIELDS.some((key) => raw[key] === undefined)) {
    return { success: false, message: "Complete the fields in this section before saving." };
  }

  const fee = dollarsToCentsOrNull(raw.feeDollars, "Flat fee");
  const percent = wholeNumberOrNull(raw.feePercent, "Percent of rent owed", 100);
  const cap = dollarsToCentsOrNull(raw.feeCapDollars, "Highest fee");
  const notice = wholeNumberOrNull(raw.noticeDays, "Days of notice", 365);
  const termsText = textOrNull(raw.terminationTermsText, "Early-ending terms");
  const renewalNotice = wholeNumberOrNull(raw.autoRenewNoticeDays, "Days of renewal notice", 365);
  const renewalText = textOrNull(raw.renewalTermsText, "Auto-renew terms");
  for (const part of [fee, percent, cap, notice, termsText, renewalNotice, renewalText]) {
    if (!part.ok) return { success: false, message: part.message };
  }

  const unusedTerm = text(raw.unusedTerm);
  if (unusedTerm !== "" && unusedTerm !== "REFUND" && unusedTerm !== "CREDIT" && unusedTerm !== "RETAIN") {
    return { success: false, message: "Choose what happens to unused prepaid time, or leave it undecided." };
  }

  const feeCents = (fee as { value: number | null }).value;
  const feePercent = (percent as { value: number | null }).value;
  const feeCapCents = (cap as { value: number | null }).value;
  if (feeCapCents !== null && feeCents === null && feePercent === null) {
    return { success: false, message: "A highest fee only makes sense together with a flat fee or a percent." };
  }
  if (feeCapCents !== null && feeCents !== null && feeCapCents < feeCents) {
    return { success: false, message: "The highest fee can't be less than the flat fee." };
  }

  const renewalNoticeDays = (renewalNotice as { value: number | null }).value;
  const renewalTermsText = (renewalText as { value: string | null }).value;

  return {
    success: true,
    update: {
      earlyTerminationFeeCents: feeCents,
      earlyTerminationFeePercent: feePercent,
      earlyTerminationFeeCapCents: feeCapCents,
      earlyTerminationNoticeDays: (notice as { value: number | null }).value,
      unusedTermTreatment: unusedTerm === "" ? null : unusedTerm,
      terminationTermsText: (termsText as { value: string | null }).value,
      autoRenewNoticeDays: renewalNoticeDays,
      renewalTermsText,
      autoRenewTermsVersion:
        renewalNoticeDays !== null && renewalTermsText !== null
          ? autoRenewTermsVersionFor(renewalNoticeDays, renewalTermsText)
          : null,
    },
  };
}

export type FeatureStatus = { available: boolean; missing: string[] };

/** Plain-English "is this switched on, and if not what is still needed" for the settings screen. */
export function termsPolicyStatus(
  settings: TerminationPolicySettings & AutoRenewPolicySettings,
): { earlyEnding: FeatureStatus; autoRenew: FeatureStatus } {
  const earlyMissing: string[] = [];
  if (settings.earlyTerminationNoticeDays == null) earlyMissing.push("days of notice");
  if (!settings.unusedTermTreatment) earlyMissing.push("what happens to unused prepaid time");
  if (settings.earlyTerminationFeeCents == null && settings.earlyTerminationFeePercent == null) {
    earlyMissing.push("a flat fee or a percent (enter 0 if there should be no fee)");
  }
  if (!settings.terminationTermsText?.trim()) earlyMissing.push("the wording customers will see about ending early");
  const renewMissing: string[] = [];
  if (settings.autoRenewNoticeDays == null) renewMissing.push("days of renewal notice");
  if (!settings.renewalTermsText?.trim()) renewMissing.push("the auto-renew terms wording");
  return {
    earlyEnding: {
      available: loadTerminationPolicy(settings) !== null,
      missing: earlyMissing,
    },
    autoRenew: {
      available: autoRenewPolicyReady(settings),
      missing: renewMissing,
    },
  };
}

/** Form defaults from saved settings: dollars as text, blanks for "not decided". */
export function termsPolicyDefaults(settings: {
  earlyTerminationFeeCents?: number | null;
  earlyTerminationFeePercent?: number | null;
  earlyTerminationFeeCapCents?: number | null;
  earlyTerminationNoticeDays?: number | null;
  unusedTermTreatment?: string | null;
  terminationTermsText?: string | null;
  autoRenewNoticeDays?: number | null;
  renewalTermsText?: string | null;
}): TermsPolicyFormValues {
  const dollars = (cents: number | null | undefined) =>
    cents == null ? "" : (cents / 100).toFixed(2);
  const whole = (n: number | null | undefined) => (n == null ? "" : String(n));
  return {
    feeDollars: dollars(settings.earlyTerminationFeeCents),
    feePercent: whole(settings.earlyTerminationFeePercent),
    feeCapDollars: dollars(settings.earlyTerminationFeeCapCents),
    noticeDays: whole(settings.earlyTerminationNoticeDays),
    unusedTerm: settings.unusedTermTreatment ?? "",
    terminationTermsText: settings.terminationTermsText ?? "",
    autoRenewNoticeDays: whole(settings.autoRenewNoticeDays),
    renewalTermsText: settings.renewalTermsText ?? "",
  };
}
