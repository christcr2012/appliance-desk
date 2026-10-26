import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { coloradoLegalHolidays } from "@/domains/tax/filing-calendar";

/**
 * TFA-1: when to act on a dated change (TAX-FEE-AUTOPILOT section 3). Pure:
 * all math runs on Colorado business-date keys (YYYY-MM-DD), so daylight
 * saving never moves a date. Working days skip weekends and Colorado legal
 * holidays. The app never pays or files by itself; this only picks the day
 * the owner should act.
 */

export type TimingEffect = "FIXED" | "COSTS" | "BENEFITS";

export function parseKey(key: string): [number, number, number] {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) throw new Error("Invalid business date: " + key);
  return [year, month, day];
}

function keyOf(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function addCalendarDays(key: string, days: number): string {
  const [year, month, day] = parseKey(key);
  return keyOf(year, month, day + days);
}

function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = parseKey(fromKey);
  const [ty, tm, td] = parseKey(toKey);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

function isWeekend(key: string): boolean {
  const [year, month, day] = parseKey(key);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function holidayKeys(year: number): Set<string> {
  return new Set(coloradoLegalHolidays(year).map((date) => businessDateKey(date)));
}

export function isWorkingDay(key: string, holidays: (year: number) => Set<string> = holidayKeys): boolean {
  if (isWeekend(key)) return false;
  return !holidays(parseKey(key)[0]).has(key);
}

/** Move back `count` working days from `key` (the starting day is not counted). */
export function subtractWorkingDays(
  key: string, count: number,
  holidays: (year: number) => Set<string> = holidayKeys,
): string {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Working days must be a whole number from 0 up.");
  let current = key;
  let left = count;
  while (left > 0) {
    current = addCalendarDays(current, -1);
    if (isWorkingDay(current, holidays)) left -= 1;
  }
  return current;
}

function maxKey(...keys: string[]): string {
  return keys.reduce((a, b) => (a > b ? a : b));
}

function minKey(...keys: string[]): string {
  return keys.reduce((a, b) => (a < b ? a : b));
}

function toDate(key: string): Date {
  const date = businessDateFromKey(key);
  if (!date) throw new Error("Invalid business date: " + key);
  return date;
}

/**
 * The day to act inside a window [opens, closes].
 * FIXED: the fixed date, exactly. BENEFITS: as soon as the window opens (or
 * today, if it already opened) — doing it early saves money. COSTS: the
 * owner's chosen percent through the window, pulled back to at least
 * `marginBusinessDays` working days before the deadline, never before the
 * window opens or today, and never after the deadline.
 */
export function whenToAct(input: {
  opens: Date;
  closes: Date;
  effect: TimingEffect;
  fixedOn?: Date;
  now: Date;
  percent: number;
  marginBusinessDays: number;
}): { actOn: Date; reason: string } {
  const opensKey = businessDateKey(input.opens);
  const closesKey = businessDateKey(input.closes);
  const nowKey = businessDateKey(input.now);
  if (opensKey > closesKey) throw new Error("The window opens after it closes.");
  if (input.percent < 85 || input.percent > 95) throw new Error("Timing percent must be from 85 through 95.");
  if (!Number.isSafeInteger(input.marginBusinessDays) || input.marginBusinessDays < 1 || input.marginBusinessDays > 10)
    throw new Error("Safety margin must be from 1 through 10 business days.");

  if (input.effect === "FIXED") {
    if (!input.fixedOn) throw new Error("A fixed date is required.");
    const fixedKey = businessDateKey(input.fixedOn);
    return { actOn: toDate(minKey(maxKey(fixedKey, opensKey), closesKey)), reason: "This date is fixed by law." };
  }
  if (input.effect === "BENEFITS") {
    return { actOn: toDate(maxKey(opensKey, nowKey)), reason: "Doing this early saves money, so do it as soon as the window opens." };
  }
  const spanDays = daysBetween(opensKey, closesKey);
  const pointKey = addCalendarDays(opensKey, Math.round((spanDays * input.percent) / 100));
  const deadlineKey = subtractWorkingDays(closesKey, input.marginBusinessDays);
  const actOnKey = minKey(maxKey(minKey(pointKey, deadlineKey), opensKey, nowKey), closesKey);
  return {
    actOn: toDate(actOnKey),
    reason: `${input.percent}% through the time allowed, at least ${input.marginBusinessDays} business ${input.marginBusinessDays === 1 ? "day" : "days"} before the deadline.`,
  };
}

/** "File and pay on" for a filing period: the window opens the day after the period ends and closes on the legal due date. */
export function fileAndPayOnDate(input: {
  periodEnd: Date;
  legalDueOn: Date;
  now: Date;
  percent: number;
  marginBusinessDays: number;
}): Date {
  const opens = toDate(addCalendarDays(businessDateKey(input.periodEnd), 1));
  return whenToAct({
    opens, closes: input.legalDueOn, effect: "COSTS", now: input.now,
    percent: input.percent, marginBusinessDays: input.marginBusinessDays,
  }).actOn;
}
