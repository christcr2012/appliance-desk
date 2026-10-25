// MCP-1 spec section 2: when a job is due, and the one state rule. Pure (no database, no clock of its own).
// Vercel runs crons in UTC, so every deadline here is computed in UTC from the rule's cron string exactly as it is
// in vercel.json. Colorado time is only for showing on screen (the backup is 2:00 AM in winter, 3:00 AM in summer).
import type { AutomationRunState } from "@prisma/client";
import { businessDateFromKey } from "@/lib/business-date";
import type { HealthState } from "./health-states";

export type CronSchedule = { minute: number; hour: number; dayOfMonth: number | null; dayOfWeek: number | null };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** A run that claims to start more than this far in the future is a clock problem, not evidence. */
export const CLOCK_SKEW_TOLERANCE_MS = 5 * MINUTE;
/** A success up to five minutes before its slot (Vercel starting a little early) still counts for that slot. */
const EARLY_START_TOLERANCE_MS = 5 * MINUTE;

function field(raw: string, min: number, max: number, cron: string): number {
  if (!/^\d{1,2}$/.test(raw)) throw new Error(`Unsupported cron form: "${cron}".`);
  const value = Number(raw);
  if (value < min || value > max) throw new Error(`Unsupported cron form: "${cron}".`);
  return value;
}

/** Only the three forms the app uses: `m h * * *` (daily), `m h * * d` (weekly), `m h D * *` (monthly). */
export function parseCron(cron: string): CronSchedule {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Unsupported cron form: "${cron}".`);
  const [m, h, dom, month, dow] = parts as [string, string, string, string, string];
  if (month !== "*") throw new Error(`Unsupported cron form: "${cron}".`);
  if (dom !== "*" && dow !== "*") throw new Error(`Unsupported cron form: "${cron}".`);
  return {
    minute: field(m, 0, 59, cron),
    hour: field(h, 0, 23, cron),
    dayOfMonth: dom === "*" ? null : field(dom, 1, 31, cron),
    dayOfWeek: dow === "*" ? null : field(dow, 0, 6, cron),
  };
}

function matchesDay(schedule: CronSchedule, day: Date): boolean {
  if (schedule.dayOfMonth !== null && day.getUTCDate() !== schedule.dayOfMonth) return false;
  if (schedule.dayOfWeek !== null && day.getUTCDay() !== schedule.dayOfWeek) return false;
  return true;
}

function slotOn(schedule: CronSchedule, dayStartUtcMs: number): Date {
  return new Date(dayStartUtcMs + schedule.hour * 60 * MINUTE + schedule.minute * MINUTE);
}

function validDate(now: Date): number {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Invalid schedule date.");
  return Math.floor(now.getTime() / MINUTE) * MINUTE; // minute precision
}

function cronOf(rule: { cron: string } | string): CronSchedule {
  return parseCron(typeof rule === "string" ? rule : rule.cron);
}

/** The most recent UTC instant matching the cron that is at or before `now` (minute precision). */
export function lastDueAt(rule: { cron: string } | string, now: Date): Date {
  const schedule = cronOf(rule);
  const at = validDate(now);
  const today = Date.UTC(new Date(at).getUTCFullYear(), new Date(at).getUTCMonth(), new Date(at).getUTCDate());
  // 62 days covers every monthly slot (a 31st skips short months at most once in a row).
  for (let back = 0; back <= 62; back += 1) {
    const dayStart = today - back * DAY;
    if (!matchesDay(schedule, new Date(dayStart))) continue;
    const slot = slotOn(schedule, dayStart);
    if (slot.getTime() <= at) return slot;
  }
  throw new Error("No due time found for this schedule.");
}

/** The first UTC instant matching the cron that is at or after `from`. */
export function nextDueAt(rule: { cron: string } | string, from: Date): Date {
  const schedule = cronOf(rule);
  const at = from.getTime();
  if (!Number.isFinite(at)) throw new Error("Invalid schedule date.");
  const d = new Date(at);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  for (let ahead = 0; ahead <= 62; ahead += 1) {
    const dayStart = today + ahead * DAY;
    if (!matchesDay(schedule, new Date(dayStart))) continue;
    const slot = slotOn(schedule, dayStart);
    if (slot.getTime() >= at) return slot;
  }
  throw new Error("No due time found for this schedule.");
}

/** When a rule added on `addedOn` (a Colorado calendar day) is first due. */
export function firstDueAt(rule: { cron: string; addedOn: string }): Date {
  const start = businessDateFromKey(rule.addedOn);
  if (!start) throw new Error(`Invalid addedOn date for a rule: "${rule.addedOn}".`);
  return nextDueAt(rule, start);
}

export type RunSnapshot = { state: AutomationRunState; startedAt: Date; budgetSeconds: number };

export type HealthStateInput = {
  rule: { cron: string; addedOn: string };
  now: Date;
  graceMinutes: number;
  paused: boolean;
  missingEnv: readonly string[];
  /** The newest run (any state). */
  latest: RunSnapshot | null;
  /** When the newest SUCCEEDED run started. */
  lastSuccessStartedAt: Date | null;
};

export type HealthStateResult = {
  state: HealthState;
  /** The slot the job should already have run for (UTC). */
  dueAt: Date;
  /** True when a run's start time was more than five minutes in the future and was ignored. */
  clockSkew: boolean;
};

/** Spec 2 state rule, first match wins. */
export function computeHealthState(input: HealthStateInput): HealthStateResult {
  const now = input.now.getTime();
  const graceMs = input.graceMinutes * MINUTE;
  const dueAt = lastDueAt(input.rule, input.now);
  const limit = now + CLOCK_SKEW_TOLERANCE_MS;
  let clockSkew = false;
  let latest = input.latest;
  if (latest && latest.startedAt.getTime() > limit) { latest = null; clockSkew = true; }
  let successAt = input.lastSuccessStartedAt;
  if (successAt && successAt.getTime() > limit) { successAt = null; clockSkew = true; }
  // The newest believable run is the last success when the newer row had an impossible start time.
  if (!latest && successAt) latest = { state: "SUCCEEDED", startedAt: successAt, budgetSeconds: 0 };

  const result = (state: HealthState): HealthStateResult => ({ state, dueAt, clockSkew });
  if (input.paused) return result("paused");
  if (input.missingEnv.length > 0) return result("unconfigured");
  if (!latest) {
    return result(now < firstDueAt(input.rule).getTime() + graceMs ? "never-ran" : "late");
  }
  if (latest.state === "RUNNING" && now - latest.startedAt.getTime() < latest.budgetSeconds * 1000) return result("running");
  if (latest.state === "FAILED") return result("failing");
  if (latest.state === "UNKNOWN" || latest.state === "RUNNING") return result("unknown");
  // SUCCEEDED, or SKIPPED (the owner's pause handled that slot on purpose).
  if (latest.startedAt.getTime() < dueAt.getTime() - EARLY_START_TOLERANCE_MS && now > dueAt.getTime() + graceMs) {
    return result("late");
  }
  return result("healthy");
}
