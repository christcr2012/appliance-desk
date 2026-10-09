import { previewSmsTemplate, renderSmsTemplate, smsPreview } from "./sms-template";

export const DAY_OF_REMINDER_BODY =
  "Robinson Appliance Rentals: Reminder: we have {{visit}} scheduled for you today{{location}}. Reply STOP to opt out or HELP for help.";
export const DAY_OF_REMINDER_RULES = {
  visit: { example: "a delivery", maxLength: 35 },
  location: { example: " at the delivery address", maxLength: 90 },
} as const;

const JOB_TYPE_LABELS: Record<string, string> = {
  DELIVERY: "a delivery", INSTALLATION: "an installation",
  SWAP: "an appliance swap", REMOVAL: "a pickup",
  MAINTENANCE_VISIT: "a maintenance visit",
};

export function renderDayOfJobReminder(job: { type: string;
  serviceAddress?: { line1: string } | null }, maxSegments: number) {
  const visit = JOB_TYPE_LABELS[job.type] ?? "a visit";
  // Do not disclose private addresses in a notification until the exact
  // customer/contact/job context is approved. Recipient knows appointment.
  const location = "";
  const text = renderSmsTemplate(DAY_OF_REMINDER_BODY, DAY_OF_REMINDER_RULES,
    { visit, location });
  const sms = smsPreview(text);
  if (sms.segments > maxSegments) throw new Error("Job reminder exceeds SMS segment budget.");
  return { text, sms };
}

export function previewDayOfReminder(maxSegments: number) {
  return previewSmsTemplate(DAY_OF_REMINDER_BODY, DAY_OF_REMINDER_RULES, maxSegments);
}
