import {
  businessDateFromKey,
  businessDateKey,
  businessDaysBetween,
} from "@/lib/business-date";

export type FilingPeriodRange = { start: Date; end: Date };
export type ReminderStage =
  | "READY"
  | `DUE_IN_${number}`
  | "DUE_TODAY"
  | "DUE_BY_LEGAL"
  | "OVERDUE";

type FilingFrequency = "MONTHLY" | "QUARTERLY" | "ANNUAL";

function parseKey(key: string): [number, number, number] {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Invalid business date key: ${key}`);
  return [year, month, day];
}

function key(year: number, month: number, day: number): string {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function fromKey(value: string): Date {
  const date = businessDateFromKey(value);
  if (!date) throw new Error(`Invalid Colorado calendar date: ${value}`);
  return date;
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addCalendarDays(value: string, days: number): string {
  const [year, month, day] = parseKey(value);
  const date = utcDate(year, month, day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function startOfContainingPeriod(
  value: string,
  frequency: FilingFrequency,
): string {
  const [year, month] = parseKey(value);
  if (frequency === "MONTHLY") return key(year, month, 1);
  if (frequency === "QUARTERLY") {
    const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
    return key(year, quarterMonth, 1);
  }
  return key(year, 1, 1);
}

function endOfPeriod(start: string, frequency: FilingFrequency): string {
  const [year, month] = parseKey(start);
  const months = frequency === "MONTHLY" ? 1 : frequency === "QUARTERLY" ? 3 : 12;
  const next = utcDate(year, month + months, 1);
  next.setUTCDate(next.getUTCDate() - 1);
  return next.toISOString().slice(0, 10);
}

function nextPeriodStart(start: string, frequency: FilingFrequency): string {
  const [year, month] = parseKey(start);
  const months = frequency === "MONTHLY" ? 1 : frequency === "QUARTERLY" ? 3 : 12;
  return utcDate(year, month + months, 1).toISOString().slice(0, 10);
}

function nthWeekday(
  year: number,
  month: number,
  weekday: number,
  occurrence: number,
): string {
  const first = utcDate(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (occurrence - 1) * 7;
  return key(year, month, day);
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const lastDay = daysInMonth(year, month);
  const last = utcDate(year, month, lastDay);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return key(year, month, lastDay - offset);
}

function statutoryHolidayKeys(year: number): string[] {
  return [
    key(year, 1, 1),
    nthWeekday(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekday(year, 2, 1, 3), // Washington-Lincoln Day
    lastWeekday(year, 5, 1), // Memorial Day
    key(year, 6, 19), // Juneteenth
    key(year, 7, 4), // Independence Day
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 10, 1, 1), // Frances Xavier Cabrini Day
    key(year, 11, 11), // Veterans Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving
    key(year, 12, 25), // Christmas
  ];
}

function holidayKeys(year: number): Set<string> {
  const values = new Set<string>();
  for (const holiday of statutoryHolidayKeys(year)) {
    values.add(holiday);
    const [y, m, d] = parseKey(holiday);
    if (utcDate(y, m, d).getUTCDay() === 0) {
      values.add(addCalendarDays(holiday, 1));
    }
  }
  return values;
}

function isWeekend(value: string): boolean {
  const [year, month, day] = parseKey(value);
  const weekday = utcDate(year, month, day).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function isColoradoLegalHoliday(value: string): boolean {
  const [year] = parseKey(value);
  return holidayKeys(year).has(value);
}

export function periodsFor(
  account: { frequency: FilingFrequency; firstPeriodStart: Date | null },
  through: Date,
): FilingPeriodRange[] {
  if (!account.firstPeriodStart) return [];

  const firstKey = businessDateKey(account.firstPeriodStart);
  const throughKey = businessDateKey(through);
  if (firstKey > throughKey) return [];

  let periodStart = startOfContainingPeriod(firstKey, account.frequency);
  const result: FilingPeriodRange[] = [];

  while (periodStart <= throughKey) {
    const periodEnd = endOfPeriod(periodStart, account.frequency);
    const clippedStart = periodStart < firstKey ? firstKey : periodStart;
    result.push({
      start: fromKey(clippedStart),
      end: fromKey(periodEnd),
    });
    periodStart = nextPeriodStart(periodStart, account.frequency);
  }

  return result;
}

export function dueOnFor(
  periodEnd: Date,
  dueDayOfFollowingMonth: number,
): Date {
  if (
    !Number.isInteger(dueDayOfFollowingMonth) ||
    dueDayOfFollowingMonth < 1 ||
    dueDayOfFollowingMonth > 31
  ) {
    throw new Error("dueDayOfFollowingMonth must be a whole day from 1 through 31.");
  }
  const [year, month] = parseKey(businessDateKey(periodEnd));
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const day = Math.min(
    dueDayOfFollowingMonth,
    daysInMonth(nextYear, nextMonth),
  );
  return fromKey(key(nextYear, nextMonth, day));
}

/**
 * Colorado statutory holidays used for filing-deadline display. C.R.S.
 * 24-11-101(1) includes Juneteenth and Frances Xavier Cabrini Day; subsection
 * (2) observes a listed holiday that falls Sunday on the following Monday.
 * One-off holidays proclaimed by the governor/president cannot be predicted
 * safely in code and must be handled by an owner due-date override.
 */
export function coloradoLegalHolidays(year: number): Date[] {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new Error("year must be a four-digit calendar year.");
  }
  return [...holidayKeys(year)].sort().map(fromKey);
}

export function legalDueOn(dueOn: Date): Date {
  let value = businessDateKey(dueOn);
  while (isWeekend(value) || isColoradoLegalHoliday(value)) {
    value = addCalendarDays(value, 1);
  }
  return fromKey(value);
}

export function reminderStages(
  period: { periodEnd: Date; dueOn: Date; legalDueOn: Date },
  account: { reminderDaysBefore: number[] },
  today: Date,
): ReminderStage[] {
  const todayKey = businessDateKey(today);
  const periodEndKey = businessDateKey(period.periodEnd);
  const dueKey = businessDateKey(period.dueOn);
  const legalKey = businessDateKey(period.legalDueOn);
  const stages: ReminderStage[] = [];

  if (todayKey === addCalendarDays(periodEndKey, 1)) {
    stages.push("READY");
  }

  const daysUntilDue = businessDaysBetween(today, period.dueOn);
  for (const days of [...new Set(account.reminderDaysBefore)]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => b - a)) {
    if (daysUntilDue === days) stages.push(`DUE_IN_${days}`);
  }

  if (todayKey === dueKey) {
    stages.push("DUE_TODAY");
  } else if (todayKey > dueKey && todayKey <= legalKey) {
    stages.push("DUE_BY_LEGAL");
  } else if (todayKey > legalKey) {
    stages.push("OVERDUE");
  }

  return stages;
}
