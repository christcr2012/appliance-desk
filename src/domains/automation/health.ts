import { Prisma, type AutomationRunState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import type { HealthState } from "./health-states";
import { computeHealthState, CLOCK_SKEW_TOLERANCE_MS, nextDueAt } from "./schedule";

export type AutomationHealthState = HealthState;

export type AutomationRuleDefinition = {
  ruleKey: string;
  label: string;
  explanation: string;
  requiredEnv: string[];
  resolutionHref: string;
  /** The vercel.json cron path that runs this rule. */
  cronPath: string;
  /** The rule's schedule exactly as in vercel.json, in UTC (Vercel runs crons in UTC). */
  cron: string;
  /** Colorado calendar day the rule started being tracked: a rule never shows late before its first due time. */
  addedOn: string;
};

/** The day due-time tracking (MCP-1) started; every rule that existed then counts from here. */
const RULES_TRACKED_FROM = "2026-10-25";

export const AUTOMATION_RULES: AutomationRuleDefinition[] = [
  { ruleKey: "expense-drafts", label: "Recurring expense drafts", explanation: "Creates draft expense records for owner review; never pays or posts automatically.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/expense-drafts", cron: "50 9 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#expense-drafts" },
  { ruleKey: "telecom-sync", label: "Phone usage sync", explanation: "Reads what the phone company says was used and charged, so the desk can show real text and call costs. It only reads; it never sends a text or places a call. It is off until owner-activated.", requiredEnv: ["CRON_SECRET", "TELECOM_SYNC_ENABLED"], cronPath: "/api/cron/telecom-sync", cron: "20 9 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#telecom-sync" },
  { ruleKey: "books-nightly:record", label: "Automatic book entries", explanation: "Records eligible business sources and updates equipment depreciation nightly after owner setup, independent of optional Stripe imports.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/books-nightly", cron: "40 9 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#books-nightly-record" },
  { ruleKey: "books-nightly", label: "Stripe books sync and reconciliation", explanation: "Imports read-only Stripe balance evidence and compares yesterday’s clearing with the owner’s opening books balance. It is off until owner-activated.", requiredEnv: ["CRON_SECRET", "STRIPE_SECRET_KEY", "BOOKS_STRIPE_SYNC_ENABLED"], cronPath: "/api/cron/books-nightly", cron: "40 9 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#books-nightly" },
  { ruleKey: "backup", label: "Daily backup", explanation: "Exports the business database to the private backup store.", requiredEnv: ["CRON_SECRET", "BLOB_READ_WRITE_TOKEN"], cronPath: "/api/cron/backup", cron: "0 9 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#backup" },
  { ruleKey: "media-copy", label: "Private media recovery copy", explanation: "Inventories private photo evidence and keeps a second recoverable copy without resurrecting privacy-deleted files.", requiredEnv: ["CRON_SECRET", "BLOB_READ_WRITE_TOKEN", "PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN", "PRIVATE_PHOTO_BLOB_STORE_ID"], cronPath: "/api/cron/backup", cron: "0 9 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#media-copy" },
  { ruleKey: "billing-reconcile:provider-ops", label: "Billing provider operations", explanation: "Reconciles durable Stripe operations that are still pending or uncertain.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/billing-reconcile", cron: "30 15 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#billing-reconcile-provider-ops" },
  { ruleKey: "billing-reconcile:bank-in-flight", label: "Bank payments being confirmed", explanation: "Asks Stripe about bank payments that are still being confirmed, and records any that cleared but were missed.", requiredEnv: ["CRON_SECRET", "STRIPE_SECRET_KEY"], cronPath: "/api/cron/billing-reconcile", cron: "30 15 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#billing-reconcile-bank-in-flight" },
  { ruleKey: "billing-reconcile:job-handoffs", label: "Job billing handoffs", explanation: "Finishes billing and credit work queued by completed field jobs.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/billing-reconcile", cron: "30 15 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#billing-reconcile-job-handoffs" },
  { ruleKey: "billing-reconcile:invoice-artifacts", label: "Invoice evidence freeze", explanation: "Freezes immutable evidence for invoices that reached a final state.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/billing-reconcile", cron: "30 15 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#billing-reconcile-invoice-artifacts" },
  { ruleKey: "billing-reconcile:retail-delivery-fees", label: "Retail delivery fee reconciliation", explanation: "Reconciles issued RDF evidence and liabilities without double-posting.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/billing-reconcile", cron: "30 15 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#billing-reconcile-retail-delivery-fees" },
  { ruleKey: "billing-reconcile:retail-delivery-fee-charges", label: "Retail delivery fee charges", explanation: "Rechecks eligible RDF charges without inventing a new provider intent.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/billing-reconcile", cron: "30 15 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#billing-reconcile-retail-delivery-fee-charges" },
  { ruleKey: "billing-reconcile:message-deliveries", label: "Message delivery reconciliation", explanation: "Checks uncertain email and text outcomes that already have a provider message id without sending them again.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/billing-reconcile", cron: "30 15 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#billing-reconcile-message-deliveries" },
  { ruleKey: "billing-reminders", label: "Billing reminders", explanation: "Queues each customer's upcoming-payment reminder once per billing cycle.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/billing-reminders", cron: "0 14 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#billing-reminders" },
  { ruleKey: "estimate-follow-ups", label: "Estimate follow-ups", explanation: "Follows up once on sent estimates that have not received a response.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/estimate-follow-ups", cron: "0 16 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#estimate-follow-ups" },
  { ruleKey: "job-reminders", label: "Job day-of reminders", explanation: "Sends opted-in customers their same-day service reminder.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/job-reminders", cron: "0 13 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#job-reminders" },
  { ruleKey: "late-fees", label: "Late fees", explanation: "Applies configured late-payment fees to eligible invoices and records the result.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/late-fees", cron: "0 15 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#late-fees" },
  { ruleKey: "collections", label: "Past-due follow-up", explanation: "Prepares the second and final past-due notices and the day-30 decision for you to approve. It never sends anything to a customer or moves money.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/collections", cron: "20 15 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#collections" },
  { ruleKey: "stored-file-cleanup", label: "Stored file clean-up", explanation: "Deletes pictures and receipt files that were removed from a record, after a waiting period, and only if nothing uses them again. Never touches a file that is still attached to anything.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/tenant-retention", cron: "30 10 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#stored-file-cleanup" },
  { ruleKey: "scheduled-prices", label: "Scheduled price changes", explanation: "Applies price changes, and decisions from Decisions & reviews, whose start day has come, once, through the normal save. Signed agreements and sent estimates keep their price.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/scheduled-prices", cron: "10 10 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#scheduled-prices" },
  { ruleKey: "tax-filing-calendar", label: "Tax filing calendar", explanation: "Creates filing periods, sends Owner-only due and license reminders, and records automation outcomes without sending customer messages.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/tax-rate-changes", cron: "5 18 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#tax-filing-calendar" },
  { ruleKey: "tax-rate-changes", label: "Sales-tax rate changes", explanation: "Applies tax-rate versions that start tomorrow to affected live Stripe subscriptions without proration.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/tax-rate-changes", cron: "5 18 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#tax-rate-changes" },
  { ruleKey: "tax-address-recheck", label: "Sales-tax address re-check", explanation: "Re-checks current tax areas on the scheduled Colorado calendar and flags jurisdiction changes for review.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/tax-address-recheck", cron: "20 13 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#tax-address-recheck" },
  { ruleKey: "tax-address-recheck:purchase-tax-catch-up", label: "Purchase tax catch-up", explanation: "Calculates use tax for appliances and resale stock that were waiting on tax setup.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/tax-address-recheck", cron: "20 13 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#tax-address-recheck-purchase-tax-catch-up" },
  { ruleKey: "tax-rate-watch", label: "Official sales-tax source watch", explanation: "Checks approved official tax pages on the scheduled Colorado calendar and surfaces page changes or repeated fetch failures without interpreting them as tax-law changes.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/tax-address-recheck", cron: "20 13 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#tax-rate-watch" },
  { ruleKey: "recall-watch", label: "Product recall check", explanation: "Reads the government's public recall list each night and lists recalls that may cover your appliances for you to check. It only reads; it never confirms a recall, holds a machine or contacts a customer.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/recall-watch", cron: "30 11 * * *", addedOn: "2026-10-26", resolutionHref: "/desk/automations#recall-watch" },
  { ruleKey: "launch-emails", label: "Launch sequence", explanation: "Advances the finite prelaunch email sequence for eligible subscribers.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/launch-emails", cron: "0 16 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#launch-emails" },
  { ruleKey: "start-renewals:auto-renewals", label: "Auto-renewal queue", explanation: "Queues or cancels renewal records according to each customer's current preference.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/start-renewals", cron: "10 7 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#start-renewals-auto-renewals" },
  { ruleKey: "start-renewals:annual-reminders", label: "Annual rental reminders", explanation: "Queues the annual month-to-month reminder when its notice window arrives.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/start-renewals", cron: "10 7 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#start-renewals-annual-reminders" },
  { ruleKey: "start-renewals:pending-notices", label: "Pending customer notices", explanation: "Attempts delivery of already-created customer notices without inventing new notice obligations.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/start-renewals", cron: "10 7 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#start-renewals-pending-notices" },
  { ruleKey: "start-renewals:billing-extensions", label: "Renewal billing extensions", explanation: "Extends provider billing only after the required renewal notice evidence is delivered.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/start-renewals", cron: "10 7 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#start-renewals-billing-extensions" },
  { ruleKey: "system-issues-sweep", label: "System health checks", explanation: "Checks known system problems without acting on billing or providers.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/billing-reconcile", cron: "30 15 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#system-issues-sweep" },
  { ruleKey: "start-renewals:due-terminations", label: "Due early endings", explanation: "Executes approved early-ending dates and records fees or items needing review.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/start-renewals", cron: "10 7 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#start-renewals-due-terminations" },
  { ruleKey: "start-renewals:close-returns", label: "Returned rental closure", explanation: "Closes rentals whose equipment is fully returned and whose agreed ending has arrived.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/start-renewals", cron: "10 7 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#start-renewals-close-returns" },
  { ruleKey: "start-renewals:start-due-renewals", label: "Due renewal start", explanation: "Starts signed renewals whose effective date has arrived and ends the prior agreement safely.", requiredEnv: ["CRON_SECRET"], cronPath: "/api/cron/start-renewals", cron: "10 7 * * *", addedOn: RULES_TRACKED_FROM, resolutionHref: "/desk/automations#start-renewals-start-due-renewals" },
];

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * The setting names a rule still needs (names only, never values). A switch named `..._ENABLED` counts only when it
 * is exactly "true", the same test its cron route uses before it runs.
 */
export function missingEnvFor(rule: AutomationRuleDefinition, env: Record<string, string | undefined> = process.env): string[] {
  return rule.requiredEnv.filter((name) => (name.endsWith("_ENABLED") ? env[name] !== "true" : !env[name]));
}

/** One row per rule from the bounded health query (spec section 3). */
export type RuleRunSummary = {
  rule_key: string;
  latest_id: string | null;
  latest_state: AutomationRunState | null;
  latest_started: Date | null;
  latest_finished: Date | null;
  latest_budget: number | null;
  latest_code: string | null;
  latest_stage: string | null;
  latest_ref: string | null;
  last_success_started: Date | null;
  last_success: Date | null;
  last_failure: Date | null;
  last_failure_code: string | null;
  last_failure_ref: string | null;
  skewed: boolean;
};

const utc = (date: Date) => date.toISOString();

/**
 * Per rule, only the newest run, the newest success and the newest failure: three rows per rule, whatever the
 * history size, through the (ruleKey, state, startedAt) index. Runs that claim to start more than five minutes after
 * `now` are a clock problem and are left out (and flagged). Ties sort by id.
 */
export async function readRuleRunSummaries(ruleKeys: string[], now: Date): Promise<RuleRunSummary[]> {
  return prisma.$queryRaw<RuleRunSummary[]>(ruleRunSummarySql(ruleKeys, now));
}

/** The bounded query itself (exported so a test can EXPLAIN exactly what runs). */
export function ruleRunSummarySql(ruleKeys: string[], now: Date): Prisma.Sql {
  const limit = utc(new Date(now.getTime() + CLOCK_SKEW_TOLERANCE_MS));
  return Prisma.sql`
    SELECT k.rule_key, l.*, sx.*, fx.*, (sk.skew_id IS NOT NULL) AS skewed
    FROM unnest(${ruleKeys}::text[]) AS k(rule_key)
    LEFT JOIN LATERAL (SELECT id AS latest_id, state AS latest_state, "startedAt" AS latest_started,
                              "finishedAt" AS latest_finished, "budgetSeconds" AS latest_budget,
                              "failureCode" AS latest_code, "failureStage" AS latest_stage, "correlationId" AS latest_ref
                       FROM "AutomationRun" WHERE "ruleKey" = k.rule_key AND "startedAt" <= ${limit}::timestamp
                       ORDER BY "startedAt" DESC, id DESC LIMIT 1) l ON true
    LEFT JOIN LATERAL (SELECT "startedAt" AS last_success_started, "finishedAt" AS last_success FROM "AutomationRun"
                       WHERE "ruleKey" = k.rule_key AND state = 'SUCCEEDED' AND "startedAt" <= ${limit}::timestamp
                       ORDER BY "startedAt" DESC, id DESC LIMIT 1) sx ON true
    LEFT JOIN LATERAL (SELECT "finishedAt" AS last_failure, "failureCode" AS last_failure_code,
                              "correlationId" AS last_failure_ref FROM "AutomationRun"
                       WHERE "ruleKey" = k.rule_key AND state = 'FAILED' AND "startedAt" <= ${limit}::timestamp
                       ORDER BY "startedAt" DESC, id DESC LIMIT 1) fx ON true
    LEFT JOIN LATERAL (SELECT id AS skew_id FROM "AutomationRun"
                       WHERE "ruleKey" = k.rule_key AND "startedAt" > ${limit}::timestamp LIMIT 1) sk ON true
  `;
}

export const RECOMMENDED_LATE_GRACE_MINUTES = 120;
export const LATE_GRACE_MIN = 15;
export const LATE_GRACE_MAX = 1440;

export function validateLateGraceMinutes(value: number): number {
  if (!Number.isInteger(value) || value < LATE_GRACE_MIN || value > LATE_GRACE_MAX) {
    throw new Error("Choose between 15 minutes and 24 hours (1440 minutes), in whole minutes.");
  }
  return value;
}

export type AutomationHealthRow = {
  ruleKey: string;
  label: string;
  explanation: string;
  state: HealthState;
  /** The slot it should already have run for (UTC; shown in Colorado time). */
  dueAt: Date;
  /** Its next usual time (UTC; shown in Colorado time). */
  nextDueAt: Date;
  graceMinutes: number;
  /** Setting names only, never values; filled only when the state is `unconfigured`. */
  missingEnv: string[];
  lastSuccessAt: Date | null;
  lastFailure: { at: Date; code: string | null; ref: string | null } | null;
  latest: { id: string; state: AutomationRunState; startedAt: Date; code: string | null; stage: string | null; ref: string | null } | null;
  clockSkew: boolean;
  resolutionHref: string;
  checkedAt: Date;
};

export async function getAutomationHealth(now = new Date()): Promise<AutomationHealthRow[]> {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { pausedAutomations: true, automationLateGraceMinutes: true },
  });
  const paused = new Set(stringArray(settings?.pausedAutomations));
  const graceMinutes = settings?.automationLateGraceMinutes ?? RECOMMENDED_LATE_GRACE_MINUTES;
  const summaries = await readRuleRunSummaries(AUTOMATION_RULES.map((rule) => rule.ruleKey), now);
  const byRule = new Map(summaries.map((row) => [row.rule_key, row]));

  return AUTOMATION_RULES.map((rule) => {
    const row = byRule.get(rule.ruleKey);
    const missingEnv = missingEnvFor(rule);
    const computed = computeHealthState({
      rule, now, graceMinutes, paused: paused.has(rule.ruleKey), missingEnv,
      latest: row?.latest_state && row.latest_started
        ? { state: row.latest_state, startedAt: row.latest_started, budgetSeconds: row.latest_budget ?? 300 }
        : null,
      lastSuccessStartedAt: row?.last_success_started ?? null,
    });
    const clockSkew = computed.clockSkew || Boolean(row?.skewed);
    // Logged by rule key only: the run row itself is ignored until the clocks agree again.
    if (clockSkew) console.warn("[automation-health] CLOCK_SKEW_IGNORED", rule.ruleKey);
    const failureAt = row?.last_failure ?? null;
    return {
      ruleKey: rule.ruleKey,
      label: rule.label,
      explanation: rule.explanation,
      state: computed.state,
      dueAt: computed.dueAt,
      nextDueAt: nextDueAt(rule, new Date(now.getTime() + 60_000)),
      graceMinutes,
      missingEnv: computed.state === "unconfigured" ? missingEnv : [],
      lastSuccessAt: row?.last_success ?? row?.last_success_started ?? null,
      lastFailure: failureAt ? { at: failureAt, code: row?.last_failure_code ?? null, ref: row?.last_failure_ref ?? null } : null,
      latest: row?.latest_id && row.latest_state
        ? { id: row.latest_id, state: row.latest_state, startedAt: row.latest_started ?? now, code: row.latest_code, stage: row.latest_stage, ref: row.latest_ref }
        : null,
      clockSkew,
      resolutionHref: rule.resolutionHref,
      checkedAt: now,
    };
  });
}

export async function getLateGraceMinutes(): Promise<number> {
  const row = await prisma.businessSettings.findUnique({
    where: { id: "singleton" }, select: { automationLateGraceMinutes: true },
  });
  return row?.automationLateGraceMinutes ?? RECOMMENDED_LATE_GRACE_MINUTES;
}

/** Owner only, audited, locked compare-and-set: a change made in another tab is never silently overwritten. */
export async function saveLateGraceMinutes(actorUserId: string, next: number, expected: number): Promise<void> {
  const value = validateLateGraceMinutes(next);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const locked = await tx.$queryRaw<{ automationLateGraceMinutes: number }[]>`
      SELECT "automationLateGraceMinutes" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE
    `;
    if (!locked.length) throw new Error("Business settings are not set up yet.");
    if (locked[0]!.automationLateGraceMinutes !== expected) {
      throw new Error("This setting was changed in another session. Reload before saving.");
    }
    if (value === expected) return;
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { automationLateGraceMinutes: value } });
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "automation.late_grace.update", entityType: "BusinessSettings", entityId: "singleton",
        oldValue: { automationLateGraceMinutes: expected }, newValue: { automationLateGraceMinutes: value },
      },
    });
  });
}

export async function setAutomationPaused(actorUserId: string, ruleKey: string, shouldPause: boolean): Promise<void> {
  if (!AUTOMATION_RULES.some((rule) => rule.ruleKey === ruleKey)) throw new Error("Unknown automation rule.");
  await prisma.$transaction(async (tx) => {
    const settings = await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
      select: { pausedAutomations: true },
    });
    const before = stringArray(settings.pausedAutomations);
    const next = shouldPause
      ? [...new Set([...before, ruleKey])].sort()
      : before.filter((key) => key !== ruleKey);
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { pausedAutomations: next } });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: shouldPause ? "automation.pause" : "automation.resume",
        entityType: "AutomationRule",
        entityId: ruleKey,
        oldValue: { paused: before.includes(ruleKey) },
        newValue: { paused: shouldPause },
      },
    });
  });
}
