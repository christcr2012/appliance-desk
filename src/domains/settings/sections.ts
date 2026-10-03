import type { BusinessSettingsUpdate } from "./index";
import { businessSettingsSchema } from "./form-schema";
import {
  SETTINGS_FIELDS,
  type EditableSettingsSection,
} from "./section-config";
import { dollarsToCents } from "@/domains/pricing/money";

export function settingsSectionUpdate(
  section: string,
  raw: Record<string, unknown>,
):
  | { success: true; update: BusinessSettingsUpdate }
  | { success: false; message: string } {
  if (!Object.hasOwn(SETTINGS_FIELDS, section))
    return {
      success: false,
      message: "Choose a settings section that can be saved.",
    };
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return {
      success: false,
      message: "Please check the fields in this section.",
    };
  const keys = SETTINGS_FIELDS[section as EditableSettingsSection];
  if (keys.some((key) => raw[key] === undefined))
    return {
      success: false,
      message: "Complete the fields in this section before saving.",
    };
  const parsed = businessSettingsSchema
    .partial()
    .safeParse(Object.fromEntries(keys.map((key) => [key, raw[key]])));
  if (!parsed.success)
    return {
      success: false,
      message:
        parsed.error.issues[0]?.message ??
        "Please check the fields in this section.",
    };
  const {
    serviceAreaCities,
    serviceAreaZips,
    deliveryFeeDollars,
    installationFeeDollars,
    removalFeeDollars,
    lateFeeFlatDollars,
    sixMonthPrepaySetDollars,
    sixMonthPrepaySingleDollars,
    twelveMonthPrepaySetDollars,
    twelveMonthPrepaySingleDollars,
    referralRewardDollars,
    taxRatePercent,
    ...rest
  } = parsed.data;
  const update: BusinessSettingsUpdate = { ...rest };
  const list = (s: string) =>
    s
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  if (serviceAreaCities !== undefined)
    update.serviceAreaCities = list(serviceAreaCities);
  if (serviceAreaZips !== undefined)
    update.serviceAreaZips = list(serviceAreaZips);
  if (taxRatePercent !== undefined)
    update.taxRatePermille = Math.round(taxRatePercent * 1000);
  for (const [key, value] of [
    ["oneTimeDeliveryFeeCents", deliveryFeeDollars],
    ["oneTimeInstallationFeeCents", installationFeeDollars],
    ["oneTimeRemovalFeeCents", removalFeeDollars],
    ["lateFeeFlatCents", lateFeeFlatDollars],
    ["sixMonthPrepayDiscountSetCents", sixMonthPrepaySetDollars],
    ["sixMonthPrepayDiscountSingleCents", sixMonthPrepaySingleDollars],
    ["twelveMonthPrepayDiscountSetCents", twelveMonthPrepaySetDollars],
    ["twelveMonthPrepayDiscountSingleCents", twelveMonthPrepaySingleDollars],
    ["referralRewardCents", referralRewardDollars],
  ] as const)
    if (value !== undefined) update[key] = dollarsToCents(value);
  return { success: true, update };
}
