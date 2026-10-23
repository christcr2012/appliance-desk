import { businessDateFromKey, businessDateKey, businessDaysBetween } from "@/lib/business-date";

export type PaperworkStatusValue = "TO_DO" | "IN_PROGRESS" | "DONE" | "NOT_NEEDED";

export const PAPERWORK_STATUS_LABEL: Record<PaperworkStatusValue, string> = {
  TO_DO: "Not started",
  IN_PROGRESS: "In progress",
  DONE: "Done / in place",
  NOT_NEEDED: "Not needed",
};

export const PAPERWORK_GROUPS = [
  "Start the business",
  "Taxes",
  "Licenses and permits",
  "Insurance",
  "Every year",
  "Other",
] as const;

/** Add whole months to a Denver business date (YYYY-MM-DD), keeping the day unless the month is shorter. */
export function addMonthsToDateKey(key: string, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match || !Number.isInteger(months)) throw new Error("Invalid date.");
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const total = year * 12 + (month - 1) + months;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(newYear, newMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${newYear}-${pad(newMonth)}-${pad(Math.min(day, lastDay))}`;
}

export type ReminderState =
  | { kind: "none" }
  | { kind: "upcoming"; daysLeft: number }
  | { kind: "due_soon"; daysLeft: number }
  | { kind: "overdue"; daysOver: number };

/** When should this item appear on the To do list? Pure so it is easy to test. */
export function reminderState(
  item: { status: PaperworkStatusValue; dueOn: Date | null; remindDaysBefore: number },
  now: Date,
): ReminderState {
  if (item.status === "NOT_NEEDED" || !item.dueOn) return { kind: "none" };
  const daysLeft = businessDaysBetween(now, item.dueOn);
  if (daysLeft < 0) return { kind: "overdue", daysOver: -daysLeft };
  if (daysLeft <= item.remindDaysBefore) return { kind: "due_soon", daysLeft };
  return { kind: "upcoming", daysLeft };
}

/** The date after "marked renewed": the old date plus the repeat length, never earlier than today. */
export function nextDueAfterRenewal(
  dueOn: Date,
  repeatEveryMonths: number,
  now: Date,
): Date {
  let key = addMonthsToDateKey(businessDateKey(dueOn), repeatEveryMonths);
  const today = businessDateKey(now);
  // A long-overdue item jumps forward to the next future date instead of staying overdue.
  for (let i = 0; key <= today && i < 200; i += 1) key = addMonthsToDateKey(key, repeatEveryMonths);
  const result = businessDateFromKey(key);
  if (!result) throw new Error("Invalid renewal date.");
  return result;
}

export function maskReference(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}
