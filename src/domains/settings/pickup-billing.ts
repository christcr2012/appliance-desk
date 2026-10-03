import {
  RECOMMENDED_PICKUP_BILLING,
  isEarlyReturnProrationBasis,
  isLateReturnRateMode,
  type PickupBillingSettings,
} from "@/domains/billing/pickup-billing";
import type { BusinessSettingsUpdate } from "./index";

/**
 * The owner's "Pickups and returns" billing settings (IN-24 / IN-26 / IN-27).
 * Typed in ordinary units (a choice, a dollar amount, on/off), checked here,
 * and stored in BusinessSettings. Owners and admins can change them. Nothing
 * here is ever hard-coded in billing code: src/domains/billing/pickup-billing.ts
 * reads whatever is saved.
 */

export const PICKUP_BILLING_FIELDS = [
  "lateReturnRateMode",
  "lateReturnFixedDailyDollars",
  "earlyReturnProrationBasis",
  "pickupDayNotBilled",
] as const;

export type PickupBillingFormValues = {
  lateReturnRateMode: string;
  lateReturnFixedDailyDollars: string;
  earlyReturnProrationBasis: string;
  pickupDayNotBilled: boolean;
};

function text(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "\u0000";
}

function dollarsToCents(raw: unknown): number | null {
  const value = text(raw);
  if (value === "") return 0;
  const match = /^\$?(\d{1,5})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function pickupBillingUpdate(
  raw: Record<string, unknown>,
): { success: true; update: BusinessSettingsUpdate } | { success: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { success: false, message: "Please check the fields in this section." };
  }
  if (PICKUP_BILLING_FIELDS.some((key) => raw[key] === undefined)) {
    return { success: false, message: "Complete the fields in this section before saving." };
  }
  if (!isLateReturnRateMode(raw.lateReturnRateMode)) {
    return { success: false, message: "Choose how the daily late-return rate is worked out." };
  }
  if (!isEarlyReturnProrationBasis(raw.earlyReturnProrationBasis)) {
    return { success: false, message: "Choose how the daily early-return credit is worked out." };
  }
  if (typeof raw.pickupDayNotBilled !== "boolean") {
    return { success: false, message: "Choose whether the pickup day is charged." };
  }
  const fixedCents = dollarsToCents(raw.lateReturnFixedDailyDollars);
  if (fixedCents === null) {
    return { success: false, message: "Fixed daily late rate: enter dollars and cents, like 5 or 2.50." };
  }
  if (raw.lateReturnRateMode === "FIXED" && fixedCents === 0) {
    return {
      success: false,
      message:
        "Fixed daily late rate: enter an amount above $0, or choose “the item's monthly price ÷ 30” instead.",
    };
  }
  return {
    success: true,
    update: {
      lateReturnRateMode: raw.lateReturnRateMode,
      lateReturnFixedDailyCents: fixedCents,
      earlyReturnProrationBasis: raw.earlyReturnProrationBasis,
      pickupDayNotBilled: raw.pickupDayNotBilled,
    },
  };
}

/** Form defaults from saved settings. */
export function pickupBillingDefaults(settings: PickupBillingSettings): PickupBillingFormValues {
  return {
    lateReturnRateMode: settings.lateReturnRateMode,
    lateReturnFixedDailyDollars:
      settings.lateReturnFixedDailyCents === 0 ? "" : (settings.lateReturnFixedDailyCents / 100).toFixed(2),
    earlyReturnProrationBasis: settings.earlyReturnProrationBasis,
    pickupDayNotBilled: settings.pickupDayNotBilled,
  };
}

export const RECOMMENDED_PICKUP_BILLING_FORM: PickupBillingFormValues =
  pickupBillingDefaults(RECOMMENDED_PICKUP_BILLING);
