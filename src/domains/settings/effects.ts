/**
 * Plain-words effects for the settings preview, and the stale-save error. A leaf module (imports nothing from the
 * settings domain) so both history.ts and preview.ts can use it without a cycle.
 */

/** Thrown when the settings were changed by someone else after the page (or preview) the person is acting on. */
export class SettingsConflictError extends Error {
  constructor(message = SETTINGS_CONFLICT_MESSAGE) {
    super(message);
    this.name = "SettingsConflictError";
  }
}

export const SETTINGS_CONFLICT_MESSAGE =
  "Someone else changed these settings after you opened this page, so nothing was saved. Reload the page to see their change, then make yours again.";

/** What each everyday setting does, in plain words, for the preview. Unlisted settings say so honestly. */
const EFFECTS: Record<string, string> = {
  fees: "New quotes, invoices and agreements use the new amount from now on. Agreements customers already signed keep the amount they locked in.",
  late: "Applies to late charges added from now on. Charges already billed do not change.",
  prepay: "New prepaid agreements use the new discount. Agreements already signed keep their discount.",
  referral: "Applies to referrals that qualify from now on. Rewards already given do not change.",
  site: "Shown on the public website and on new paperwork after you save. Paperwork already signed is not rewritten.",
  area: "Decides who can request service from now on. Existing customers and signed agreements are not changed.",
  visits: "Applies to visits scheduled from now on. Visits already scheduled keep their times.",
  switchlike: "Applies to new quotes and agreements from now on. Signed agreements keep the terms they locked in.",
};
const EFFECT_FOR: Record<string, keyof typeof EFFECTS> = {
  publicBusinessName: "site", publicPhone: "site", publicEmail: "site", publicAddress: "site",
  hours: "site", holidayClosures: "site", socialLinks: "site", logoUrl: "site",
  serviceAreaCities: "area", serviceAreaZips: "area",
  oneTimeDeliveryFeeCents: "fees", oneTimeInstallationFeeCents: "fees", oneTimeRemovalFeeCents: "fees",
  lateFeeGraceDays: "late", lateFeeFlatCents: "late", lateFeePercent: "late",
  sixMonthPrepayDiscountSetCents: "prepay", sixMonthPrepayDiscountSingleCents: "prepay",
  twelveMonthPrepayDiscountSetCents: "prepay", twelveMonthPrepayDiscountSingleCents: "prepay",
  twelveMonthPrepayFreeMonthEnabled: "prepay",
  referralRewardCents: "referral",
  damageWaiverEnabled: "switchlike", depositEnabled: "switchlike",
  draftReservationHoldDays: "visits", defaultJobDurationMinutes: "visits",
  staffMayWorkUnassignedJobs: "visits", pickupDayNotBilled: "visits", outOfServiceEscalationDays: "visits",
};

export function settingEffect(key: string): string {
  const kind = EFFECT_FOR[key];
  return kind ? EFFECTS[kind] : "What this changes is not shown for this setting. Check its own screen.";
}
