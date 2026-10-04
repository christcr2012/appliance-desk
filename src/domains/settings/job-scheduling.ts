import type { BusinessSettingsUpdate } from "./index";

/**
 * The owner's "Visits and scheduling" settings (Batch C, P1-A and P2-E). Typed in ordinary units (minutes, on/off),
 * checked here, stored in BusinessSettings. Owners and admins can change them.
 */
export const RECOMMENDED_JOB_DURATION_MINUTES = 120;
export const JOB_DURATION_SETTING_MIN = 15;
export const JOB_DURATION_SETTING_MAX = 720;
export const RECOMMENDED_STAFF_MAY_WORK_UNASSIGNED_JOBS = true;

export type JobSchedulingFormValues = { defaultJobDurationMinutes: string; staffMayWorkUnassignedJobs: boolean };

export function jobSchedulingDefaults(settings: {
  defaultJobDurationMinutes: number;
  staffMayWorkUnassignedJobs?: boolean;
}): JobSchedulingFormValues {
  return {
    defaultJobDurationMinutes: String(settings.defaultJobDurationMinutes),
    staffMayWorkUnassignedJobs: settings.staffMayWorkUnassignedJobs ?? RECOMMENDED_STAFF_MAY_WORK_UNASSIGNED_JOBS,
  };
}

export function jobSchedulingUpdate(
  raw: Record<string, unknown>,
): { success: true; update: BusinessSettingsUpdate } | { success: false; message: string } {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    raw.defaultJobDurationMinutes === undefined ||
    typeof raw.staffMayWorkUnassignedJobs !== "boolean"
  ) {
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
  return { success: true, update: { defaultJobDurationMinutes: minutes, staffMayWorkUnassignedJobs: raw.staffMayWorkUnassignedJobs } };
}
