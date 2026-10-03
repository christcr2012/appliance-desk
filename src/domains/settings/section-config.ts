export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Business profile" },
  { id: "service-area", label: "Service area" },
  { id: "products", label: "Products and pricing" },
  { id: "policies", label: "Rental policies" },
  { id: "terms", label: "Ending and renewing rentals" },
  { id: "website", label: "Website" },
  { id: "notifications", label: "Notifications" },
  { id: "staff", label: "Staff" },
  { id: "integrations", label: "Integrations" },
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];
export type EditableSettingsSection = "profile" | "service-area" | "policies";
export function settingsSection(value?: string): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s.id === value)?.id ?? "profile";
}
export const SETTINGS_FIELDS = {
  profile: [
    "publicBusinessName",
    "publicPhone",
    "publicEmail",
    "publicAddress",
  ],
  "service-area": ["serviceAreaCities", "serviceAreaZips"],
  policies: [
    "deliveryFeeDollars",
    "installationFeeDollars",
    "removalFeeDollars",
    "damageWaiverEnabled",
    "depositEnabled",
    "lateFeeGraceDays",
    "lateFeeFlatDollars",
    "lateFeePercent",
    "taxRatePermille",
    "taxRateConfirmed",
    "sixMonthPrepaySetDollars",
    "sixMonthPrepaySingleDollars",
    "twelveMonthPrepaySetDollars",
    "twelveMonthPrepaySingleDollars",
    "twelveMonthPrepayFreeMonthEnabled",
    "referralRewardDollars",
    "draftReservationHoldDays",
  ],
} as const;
