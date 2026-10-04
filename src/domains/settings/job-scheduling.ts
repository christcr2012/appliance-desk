import type { BusinessSettingsUpdate } from "./index";

/**
 * The owner's "Visits and scheduling" settings (Batch C, P1-A). Typed in ordinary units (minutes),
 * checked here, stored in BusinessSettings. Owners and admins can change them.
 */
export const RECOMMENDED_JOB_DURATION_MINUTES = 120;
export const JOB_DURATION_SETTING_MIN = 15;
export const JOB_DURATION_SETTING_MAX = 720;

export type JobSchedulingFormValues = { defaultJobDurationMinutes: string };

export function jobSchedulingDefaults(settings: { defaultJobDurationMinutes: number }): JobSchedulingFormValues {
  return { defaultJobDurationMinutes: String(settings.defaultJobDurationMinutes) };
}

export function jobSchedulingUpdate(
  raw: Record<string, unknown>,
): { success: true; update: BusinessSettingsUpdate } | { success: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.defaultJobDurationMinutes === undefined) {
    return { success: false, message: "Complete the fields in this section before saving." };
  }
  const text = typeof raw.defaultJobDurationMinutes === "number" ? String(raw.defaultJobDurationMinutes) : raw.defaultJobDurationMinutes;
  if (typeof text !== "string" || !/^\d{1,4}$/.test(text.trim())) {
    return { success: false, message: "Usual visit length: enter a whole number of minutes, like 120." };
  }
  const minutes = Number(text.trim());
  if (minutes < JOB_DURATION_SETTING_MIN || minutes > JOB_DURATION_SETTING_MAX) {
    return {
      success: false,
      message: `Usual visit length: enter between ${JOB_DURATION_SETTING_MIN} and ${JOB_DURATION_SETTING_MAX} minutes.`,
    };
  }
  return { success: true, update: { defaultJobDurationMinutes: minutes } };
}
