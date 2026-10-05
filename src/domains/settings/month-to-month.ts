import { DEFAULT_ANNUAL_REMINDER_TEXT, DEFAULT_TERMS_CHANGE_TEXT, unknownPlaceholders } from "@/domains/notices/wording";

/**
 * The owner's month-to-month notice settings (Batch B2, B2-10 / B2-12): how long a terms change waits after the
 * customer's notice was delivered, and the wording of the two notices. Pure so the settings screen can import it.
 * A blank wording means "use the starting draft" and is saved as null.
 */
export const MONTH_TO_MONTH_CHANGE_DAYS_MIN = 30;
export const MONTH_TO_MONTH_CHANGE_DAYS_MAX = 90;
export const RECOMMENDED_MONTH_TO_MONTH_CHANGE_DAYS = 30;
const MAX_TEXT = 5000;

export type MonthToMonthSettingsValues = {
  monthToMonthChangeNoticeDays: string;
  termsChangeNoticeText: string;
  annualReminderText: string;
};

export function monthToMonthSettingsDefaults(settings: {
  monthToMonthChangeNoticeDays?: number;
  termsChangeNoticeText?: string | null;
  annualReminderText?: string | null;
}): MonthToMonthSettingsValues {
  return {
    monthToMonthChangeNoticeDays: String(settings.monthToMonthChangeNoticeDays ?? RECOMMENDED_MONTH_TO_MONTH_CHANGE_DAYS),
    termsChangeNoticeText: settings.termsChangeNoticeText ?? "",
    annualReminderText: settings.annualReminderText ?? "",
  };
}

export const MONTH_TO_MONTH_STARTING_DRAFTS = {
  termsChangeNoticeText: DEFAULT_TERMS_CHANGE_TEXT,
  annualReminderText: DEFAULT_ANNUAL_REMINDER_TEXT,
} as const;

export function parseMonthToMonthSettings(
  raw: Record<string, unknown>,
):
  | { success: true; days: number; termsChangeNoticeText: string | null; annualReminderText: string | null }
  | { success: false; message: string } {
  const daysText = String(raw?.monthToMonthChangeNoticeDays ?? "").trim();
  if (!/^\d{1,3}$/.test(daysText)) {
    return { success: false, message: `Days before a change applies: enter a whole number from ${MONTH_TO_MONTH_CHANGE_DAYS_MIN} to ${MONTH_TO_MONTH_CHANGE_DAYS_MAX}.` };
  }
  const days = Number(daysText);
  if (days < MONTH_TO_MONTH_CHANGE_DAYS_MIN || days > MONTH_TO_MONTH_CHANGE_DAYS_MAX) {
    return { success: false, message: `Days before a change applies: enter a whole number from ${MONTH_TO_MONTH_CHANGE_DAYS_MIN} to ${MONTH_TO_MONTH_CHANGE_DAYS_MAX}.` };
  }
  const texts: Array<string | null> = [];
  for (const [key, label] of [
    ["termsChangeNoticeText", "Terms-change notice wording"],
    ["annualReminderText", "Yearly reminder wording"],
  ] as const) {
    const value = typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
    if (value.length > MAX_TEXT || value.includes("\u0000")) {
      return { success: false, message: `${label}: keep it under ${MAX_TEXT} characters.` };
    }
    const bad = unknownPlaceholders(value);
    if (bad.length > 0) {
      return { success: false, message: `${label}: ${bad.join(", ")} is not a name we can fill in. Check the list under the box.` };
    }
    texts.push(value === "" ? null : value);
  }
  return { success: true, days, termsChangeNoticeText: texts[0]!, annualReminderText: texts[1]! };
}
