import { createHash } from "node:crypto";
import { formatCents } from "@/domains/pricing";
import {
  loadTerminationPolicy,
  type AutoRenewPolicySettings,
  type TerminationPolicy,
  type TerminationPolicySettings,
} from "./term-policy";

/**
 * The ending/renewal terms a fixed-term agreement is locked to (Chris,
 * 2026-10-03): changing the system-wide terms must never change a lease that
 * is already signed. The terms are frozen when the agreement is sent for
 * signing (the customer sees and signs exactly these), built from the owner's
 * per-customer override when there is one, otherwise from the system-wide
 * settings. Pure: no database.
 *
 * A section that was not fully set at that moment is stored as null, which
 * means "never agreed", so that feature stays unavailable for that agreement.
 */

export type TermsValues = TerminationPolicySettings &
  Pick<AutoRenewPolicySettings, "autoRenewNoticeDays" | "renewalTermsText">;

export type TermsSnapshot = {
  /** Shape version of this JSON, for future changes. */
  shape: 1;
  source: "SYSTEM" | "CUSTOM";
  capturedAt: string;
  termination: {
    feeCents: number | null;
    feePercent: number | null;
    feeCapCents: number | null;
    noticeDays: number;
    unusedTerm: "REFUND" | "CREDIT" | "RETAIN";
    termsText: string;
  } | null;
  autoRenew: {
    noticeDays: number;
    termsText: string;
    termsVersion: string;
  } | null;
};

const VALUE_KEYS = [
  "earlyTerminationFeeCents",
  "earlyTerminationFeePercent",
  "earlyTerminationFeeCapCents",
  "earlyTerminationNoticeDays",
  "unusedTermTreatment",
  "terminationTermsText",
  "autoRenewNoticeDays",
  "renewalTermsText",
] as const;

/** Version label for auto-renew terms: changes whenever the notice period or wording changes. */
export function autoRenewTermsVersionFor(noticeDays: number, termsText: string): string {
  return `ar-${createHash("sha256").update(JSON.stringify([noticeDays, termsText])).digest("hex").slice(0, 10)}`;
}

/** Keep only known policy keys from untrusted JSON (a stored override). */
export function sanitizeTermsOverride(raw: unknown): Partial<TermsValues> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const key of VALUE_KEYS) {
    if (source[key] !== undefined) clean[key] = source[key];
  }
  return clean as Partial<TermsValues>;
}

/**
 * Build the terms an agreement will be locked to. Any field present in the
 * override replaces the system-wide value (an explicit null means "not
 * available for this customer"); fields the override leaves out use the
 * system-wide value.
 */
export function buildTermsSnapshot(
  system: TermsValues,
  override: unknown,
  now: Date,
): TermsSnapshot {
  const custom = sanitizeTermsOverride(override);
  const merged: TermsValues = { ...system, ...custom };

  const policy = loadTerminationPolicy(merged);
  const renewalDays = merged.autoRenewNoticeDays;
  const renewalText = merged.renewalTermsText?.trim() ? merged.renewalTermsText : null;
  const renewalReady =
    typeof renewalDays === "number" &&
    Number.isSafeInteger(renewalDays) &&
    renewalDays >= 0 &&
    renewalText !== null;

  return {
    shape: 1,
    source: Object.keys(custom).length > 0 ? "CUSTOM" : "SYSTEM",
    capturedAt: now.toISOString(),
    termination: policy
      ? {
          feeCents: policy.feeCents,
          feePercent: policy.feePercent,
          feeCapCents: policy.feeCapCents,
          noticeDays: policy.noticeDays,
          unusedTerm: policy.unusedTerm,
          termsText: merged.terminationTermsText as string,
        }
      : null,
    autoRenew: renewalReady
      ? {
          noticeDays: renewalDays,
          termsText: renewalText,
          termsVersion: autoRenewTermsVersionFor(renewalDays, renewalText),
        }
      : null,
  };
}

function asSnapshot(raw: unknown): Partial<TermsSnapshot> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Partial<TermsSnapshot>;
}

/** The locked early-termination policy, or null when none was agreed (or the stored JSON is not usable). */
export function snapshotTerminationPolicy(raw: unknown): TerminationPolicy | null {
  const termination = asSnapshot(raw)?.termination;
  if (!termination || typeof termination !== "object") return null;
  return loadTerminationPolicy({
    earlyTerminationFeeCents: termination.feeCents,
    earlyTerminationFeePercent: termination.feePercent,
    earlyTerminationFeeCapCents: termination.feeCapCents,
    earlyTerminationNoticeDays: termination.noticeDays,
    unusedTermTreatment: termination.unusedTerm,
    terminationTermsText: termination.termsText,
  });
}

/** The locked auto-renew terms, or null when none were agreed. */
export function snapshotAutoRenew(raw: unknown): TermsSnapshot["autoRenew"] {
  const autoRenew = asSnapshot(raw)?.autoRenew;
  if (!autoRenew || typeof autoRenew !== "object") return null;
  if (
    typeof autoRenew.noticeDays !== "number" ||
    typeof autoRenew.termsText !== "string" ||
    autoRenew.termsText.trim() === "" ||
    typeof autoRenew.termsVersion !== "string" ||
    autoRenew.termsVersion.trim() === ""
  ) {
    return null;
  }
  return autoRenew;
}

export type TermsDisclosure = {
  /** Plain-English lines about ending the agreement early; empty when none were agreed. */
  ending: { lines: string[]; termsText: string } | null;
  /** Auto-renew wording the customer is shown; null when none were agreed. */
  autoRenew: { noticeLine: string; termsText: string } | null;
};

const UNUSED_TERM_LINE: Record<"REFUND" | "CREDIT" | "RETAIN", string> = {
  REFUND: "Money paid for months you no longer use is refunded.",
  CREDIT: "Money paid for months you no longer use becomes a credit on your account.",
  RETAIN: "Money paid for months you no longer use is not refunded.",
};

function daysLabel(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * What the customer must be shown before signing: exactly the locked terms
 * that a later termination quote or auto-renew consent will rely on. Built
 * from the same readers those features use, so a term that is not shown here
 * can never be relied on later.
 */
export function describeSnapshotTerms(raw: unknown): TermsDisclosure {
  const policy = snapshotTerminationPolicy(raw);
  const termsText = asSnapshot(raw)?.termination?.termsText;
  let ending: TermsDisclosure["ending"] = null;
  if (policy && typeof termsText === "string" && termsText.trim() !== "") {
    const lines: string[] = [];
    const fee: string[] = [];
    if (policy.feeCents) fee.push(formatCents(policy.feeCents));
    if (policy.feePercent) fee.push(`${policy.feePercent}% of the remaining rent`);
    lines.push(
      fee.length === 0
        ? "Ending early: no early-ending fee."
        : `Ending early fee: ${fee.length === 2 ? `the larger of ${fee[0]} or ${fee[1]}` : fee[0]}${
            policy.feeCapCents !== null ? `, never more than ${formatCents(policy.feeCapCents)}` : ""
          }.`,
    );
    lines.push(`Notice needed to end early: ${daysLabel(policy.noticeDays)}.`);
    lines.push("An early ending takes effect on a monthly billing date, after the notice period.");
    lines.push(UNUSED_TERM_LINE[policy.unusedTerm]);
    ending = { lines, termsText };
  }
  const renew = snapshotAutoRenew(raw);
  return {
    ending,
    autoRenew: renew
      ? {
          noticeLine: `You can opt out of automatic renewal with ${daysLabel(renew.noticeDays)} notice.`,
          termsText: renew.termsText,
        }
      : null,
  };
}
