import type { BusinessSettingsUpdate } from "./index";

/**
 * "When equipment comes back early" (docs/archive/designs-completed/BATCH-B2.md B2-19, owner answer IN-29). These are the owner's
 * default choices for a rental whose equipment is all picked up before its agreed ending. They are only defaults:
 * on the early-return screen the owner can change any of them for one rental. Pure logic (no database) so the
 * settings form can use it.
 */

export type EarlyReturnBilling = "KEEP_TO_AGREED_END" | "END_AT_PICKUP";
export type EarlyReturnUnusedDays = "KEEP" | "CREDIT" | "REFUND";
export type EarlyReturnFee = "AGREED_TERMS_FEE" | "NO_FEE";
export type EarlyReturnHandling = "ASK_ME" | "APPLY_DEFAULTS";
export type EarlyReturnProrationBasis = "MONTHLY_DIV_30" | "ACTUAL_DAYS_IN_MONTH";

export type EarlyReturnSettings = {
  billing: EarlyReturnBilling;
  unusedDays: EarlyReturnUnusedDays;
  fee: EarlyReturnFee;
  handling: EarlyReturnHandling;
  prorationBasis: EarlyReturnProrationBasis;
};

export const RECOMMENDED_EARLY_RETURN: EarlyReturnSettings = {
  billing: "KEEP_TO_AGREED_END",
  unusedDays: "KEEP",
  fee: "AGREED_TERMS_FEE",
  handling: "ASK_ME",
  prorationBasis: "MONTHLY_DIV_30",
};

const BILLING = ["KEEP_TO_AGREED_END", "END_AT_PICKUP"] as const;
const UNUSED = ["KEEP", "CREDIT", "REFUND"] as const;
const FEE = ["AGREED_TERMS_FEE", "NO_FEE"] as const;
const HANDLING = ["ASK_ME", "APPLY_DEFAULTS"] as const;
const BASIS = ["MONTHLY_DIV_30", "ACTUAL_DAYS_IN_MONTH"] as const;

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Read the settings row defensively: an unknown stored value falls back to the recommended one. */
export function earlyReturnSettingsFrom(row: {
  earlyReturnBilling?: string | null;
  earlyReturnUnusedDays?: string | null;
  earlyReturnFee?: string | null;
  earlyReturnHandling?: string | null;
  earlyReturnProrationBasis?: string | null;
} | null | undefined): EarlyReturnSettings {
  const r = row ?? {};
  return {
    billing: pick(BILLING, r.earlyReturnBilling, RECOMMENDED_EARLY_RETURN.billing),
    unusedDays: pick(UNUSED, r.earlyReturnUnusedDays, RECOMMENDED_EARLY_RETURN.unusedDays),
    fee: pick(FEE, r.earlyReturnFee, RECOMMENDED_EARLY_RETURN.fee),
    handling: pick(HANDLING, r.earlyReturnHandling, RECOMMENDED_EARLY_RETURN.handling),
    prorationBasis: pick(BASIS, r.earlyReturnProrationBasis, RECOMMENDED_EARLY_RETURN.prorationBasis),
  };
}

export const EARLY_RETURN_FIELDS = ["billing", "unusedDays", "fee", "handling", "prorationBasis"] as const;

export type EarlyReturnFormValues = EarlyReturnSettings;

export function earlyReturnUpdate(
  raw: Record<string, unknown>,
): { success: true; update: BusinessSettingsUpdate } | { success: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { success: false, message: "Please check the fields in this section." };
  }
  if (EARLY_RETURN_FIELDS.some((key) => raw[key] === undefined)) {
    return { success: false, message: "Complete the fields in this section before saving." };
  }
  if (!(BILLING as readonly unknown[]).includes(raw.billing)) {
    return { success: false, message: "Choose what happens to the monthly bill when equipment comes back early." };
  }
  if (!(UNUSED as readonly unknown[]).includes(raw.unusedDays)) {
    return { success: false, message: "Choose what happens to days that were already paid for." };
  }
  if (!(FEE as readonly unknown[]).includes(raw.fee)) {
    return { success: false, message: "Choose whether an early-ending fee is charged." };
  }
  if (!(HANDLING as readonly unknown[]).includes(raw.handling)) {
    return { success: false, message: "Choose whether you are asked or the choices are applied automatically." };
  }
  if (!(BASIS as readonly unknown[]).includes(raw.prorationBasis)) {
    return { success: false, message: "Choose how a daily amount is worked out." };
  }
  return {
    success: true,
    update: {
      earlyReturnBilling: raw.billing as string,
      earlyReturnUnusedDays: raw.unusedDays as string,
      earlyReturnFee: raw.fee as string,
      earlyReturnHandling: raw.handling as string,
      earlyReturnProrationBasis: raw.prorationBasis as string,
    },
  };
}

export function earlyReturnDefaults(settings: EarlyReturnSettings): EarlyReturnFormValues {
  return { ...settings };
}
