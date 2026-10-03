import { createHash } from "node:crypto";

/**
 * The owner's termination and renewal policy rules. Pure (no database), so the
 * settings screen and the term logic read the same definition of "set".
 * Every value comes from BusinessSettings; null means "not decided" and is
 * never replaced by a default.
 */

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export type UnusedTermTreatment = "REFUND" | "CREDIT" | "RETAIN";

export type TerminationPolicy = {
  feeCents: number | null;
  feePercent: number | null;
  feeCapCents: number | null;
  noticeDays: number;
  unusedTerm: UnusedTermTreatment;
  /** Fingerprint of every policy value and the owner's terms text; changes whenever any of them changes. */
  version: string;
};

export type TerminationPolicySettings = {
  earlyTerminationFeeCents?: number | null;
  earlyTerminationFeePercent?: number | null;
  earlyTerminationFeeCapCents?: number | null;
  earlyTerminationNoticeDays?: number | null;
  unusedTermTreatment?: string | null;
  terminationTermsText?: string | null;
};

export type AutoRenewPolicySettings = {
  autoRenewNoticeDays?: number | null;
  autoRenewTermsVersion?: string | null;
  renewalTermsText?: string | null;
};

/**
 * Returns the termination policy, or null when it is not fully set or any
 * value is invalid. Required: notice days, unused-term treatment, and at least
 * one fee value (0 is a valid, deliberate "no fee"; null is "not decided"),
 * and the terms wording customers will see.
 */
export function loadTerminationPolicy(
  settings: TerminationPolicySettings,
): TerminationPolicy | null {
  const {
    earlyTerminationFeeCents: feeCents = null,
    earlyTerminationFeePercent: feePercent = null,
    earlyTerminationFeeCapCents: feeCapCents = null,
    earlyTerminationNoticeDays: noticeDays = null,
    unusedTermTreatment: unusedTerm = null,
    terminationTermsText: termsText = null,
  } = settings;

  if (!isNonNegativeInt(noticeDays)) return null;
  if (unusedTerm !== "REFUND" && unusedTerm !== "CREDIT" && unusedTerm !== "RETAIN") return null;
  if (feeCents === null && feePercent === null) return null;
  if (feeCents !== null && !isNonNegativeInt(feeCents)) return null;
  if (feePercent !== null && (!isNonNegativeInt(feePercent) || feePercent > 100)) return null;
  if (feeCapCents !== null && !isNonNegativeInt(feeCapCents)) return null;
  // Customers must be shown the owner's wording before ending early is
  // offered, so blank wording is an incomplete policy (same as auto-renew).
  if (typeof termsText !== "string" || termsText.trim() === "") return null;

  const version = createHash("sha256")
    .update(
      JSON.stringify([feeCents, feePercent, feeCapCents, noticeDays, unusedTerm, termsText]),
    )
    .digest("hex")
    .slice(0, 12);
  return { feeCents, feePercent, feeCapCents, noticeDays, unusedTerm, version };
}

/** Auto-renew needs a notice period, a published terms version and the terms text. */
export function autoRenewPolicyReady(settings: AutoRenewPolicySettings): boolean {
  return (
    isNonNegativeInt(settings.autoRenewNoticeDays ?? null) &&
    Boolean(settings.autoRenewTermsVersion?.trim()) &&
    Boolean(settings.renewalTermsText?.trim())
  );
}
