import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

/**
 * CMP-4: the pure local-filing schedules. Each obligation's dates derive
 * from a fact the owner recorded — never from a guess: the FMCSA reads
 * the USDOT biennial update month and year off the number's last two
 * digits; Greeley's license renews every two years on its license date;
 * the truck registration renews in its recorded registration month.
 * All math runs on Colorado business-date keys so daylight saving never
 * moves a date.
 */

export interface LocalPeriod {
  periodKey: string;
  opens: Date;
  dueOn: Date;
  effect: "COSTS";
}

const pad = (n: number) => String(n).padStart(2, "0");

function dateOf(key: string): Date {
  const date = businessDateFromKey(key);
  if (!date) throw new Error(`Bad schedule date: ${key}`);
  return date;
}

function lastDayKey(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Shift a (year, month) pair by whole months. */
function monthShift(year: number, month: number, delta: number): [number, number] {
  const total = year * 12 + (month - 1) + delta;
  return [Math.floor(total / 12), (total % 12) + 1];
}

function shiftKeyDays(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export interface UsdotSchedule {
  /** Filing month, 1-12 (the last digit: 1-9 = Jan-Sep, 0 = October). */
  month: number;
  /** Whether updates fall in odd or even years (the next-to-last digit). */
  parity: "odd" | "even";
}

/** The FMCSA biennial schedule read off a USDOT number, or null when the number is not recorded (or too short to read). */
export function usdotSchedule(usdotNumber: string | null): UsdotSchedule | null {
  if (!usdotNumber) return null;
  const digits = usdotNumber.replace(/\D/g, "");
  if (digits.length < 2) return null;
  const last = Number(digits[digits.length - 1]);
  const second = Number(digits[digits.length - 2]);
  return { month: last === 0 ? 10 : last, parity: second % 2 === 1 ? "odd" : "even" };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function usdotScheduleWords(usdotNumber: string | null): string | null {
  const schedule = usdotSchedule(usdotNumber);
  if (!schedule) return null;
  return `Your update falls in ${MONTH_NAMES[schedule.month - 1]} of ${schedule.parity} years — the FMCSA reads that off the last two digits of your USDOT number.`;
}

/** The USDOT update period falling in `year`, when the year's parity matches the number's. */
export function usdotPeriods(year: number, usdotNumber: string | null): LocalPeriod[] {
  const schedule = usdotSchedule(usdotNumber);
  if (!schedule) return [];
  if ((year % 2 === 1) !== (schedule.parity === "odd")) return [];
  const [opensYear, opensMonth] = monthShift(year, schedule.month, -2);
  return [
    {
      periodKey: `${year}`,
      opens: dateOf(`${opensYear}-${pad(opensMonth)}-01`),
      dueOn: dateOf(lastDayKey(year, schedule.month)),
      effect: "COSTS",
    },
  ];
}

/**
 * The Greeley license renewal falling in `year`: every two years on the
 * license date, opening 60 days ahead. A February 29 license date renews
 * on February 28 in the years without one.
 */
export function greeleyPeriods(year: number, licenseDate: Date | null): LocalPeriod[] {
  if (!licenseDate) return [];
  const [licenseYear, licenseMonth, licenseDay] = businessDateKey(licenseDate).split("-").map(Number);
  if (year <= licenseYear || (year - licenseYear) % 2 !== 0) return [];
  const day = Math.min(licenseDay, Number(lastDayKey(year, licenseMonth).slice(8)));
  const dueKey = `${year}-${pad(licenseMonth)}-${pad(day)}`;
  return [
    { periodKey: `${year}`, opens: dateOf(shiftKeyDays(dueKey, -60)), dueOn: dateOf(dueKey), effect: "COSTS" },
  ];
}

/**
 * CMP-5: the Colorado new-hire report for the FIRST hire — one period in
 * the hire's year, due 20 calendar days after the start date (the
 * verified Colorado rule). Later hires ride the payroll routine; this
 * filing exists so the first deadline is never missed.
 */
export function newHirePeriods(year: number, firstHireDate: Date | null): LocalPeriod[] {
  if (!firstHireDate) return [];
  const hireKey = businessDateKey(firstHireDate);
  if (Number(hireKey.slice(0, 4)) !== year) return [];
  return [
    { periodKey: hireKey, opens: dateOf(hireKey), dueOn: dateOf(shiftKeyDays(hireKey, 20)), effect: "COSTS" },
  ];
}

/** The truck registration renewal for `year`: due the last day of the registration month, open from the month before. */
export function vehiclePeriods(year: number, registrationMonth: number | null): LocalPeriod[] {
  if (!registrationMonth || registrationMonth < 1 || registrationMonth > 12) return [];
  const [opensYear, opensMonth] = monthShift(year, registrationMonth, -1);
  return [
    {
      periodKey: `${year}`,
      opens: dateOf(`${opensYear}-${pad(opensMonth)}-01`),
      dueOn: dateOf(lastDayKey(year, registrationMonth)),
      effect: "COSTS",
    },
  ];
}
