import { reportBackgroundError } from "@/lib/report-error";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { Prisma, type AutomationRun } from "@prisma/client";
import { businessDateKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { recordSystemIssue, resolveSystemIssue } from "@/domains/system-issues";
import { classifyFailure, newCorrelationId } from "./failures";

export type AutomationOutcome = "RAN" | "ALREADY_RAN" | "FAILED" | "PAUSED";

export type RunAutomationInput = {
  ruleKey: string;
  runKeyOverride?: string; // manual backup runs are isolated from the daily slot
  actorUserId?: string; // owner checked inside the backup claim transaction
  now?: Date;
  budgetSeconds?: number;
  work: (context: { runId: string }) => Promise<{ counts: Record<string, number> }>;
};

export type RunAutomationResult = {
  outcome: AutomationOutcome;
  runId: string | null;
};

export function automationSlot(now = new Date()): string {
  return businessDateKey(now);
}

function environmentName(): string {
  if (process.env.CI === "true") return "ci";
  const vercel = process.env.VERCEL_ENV;
  if (vercel === "production" || vercel === "preview" || vercel === "development") return vercel;
  return "development";
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function pausedRuleKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Legacy scrubbed text kept in `AutomationRun.error` for old readers only. Nothing shows it: screens, issues, emails
 * and agent output use the typed failure code's explanation instead (MCP-1).
 */
export function safeError(cause: unknown): string {
  const raw = cause instanceof Error ? `${cause.name}: ${cause.message}` : "Unknown automation failure";
  return raw
    .replace(/"address"\s*:\s*"(?:[^"\\]|\\.)*"/gi, '"address":"[address]"')
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]+\b/g, "[secret]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[phone]")
    .replace(/\b\d{1,6}\s+(?:[A-Za-z]+\s+){0,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Lane|Ln|Court|Ct|Way|Pl|Place|Pkwy|Parkway)\b\.?/gi, "[address]")
    .slice(0, 500);
}

function validateCounts(counts: Record<string, number>): Record<string, number> {
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) {
    if (!Number.isInteger(value)) throw new Error(`Automation count ${key} must be an integer.`);
    clean[key] = value;
  }
  return clean;
}

async function settingsPaused(ruleKey: string): Promise<boolean> {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { pausedAutomations: true },
  });
  return pausedRuleKeys(settings?.pausedAutomations).includes(ruleKey);
}

async function createRun(ruleKey: string, runKey: string, budgetSeconds: number, now: Date, actorUserId?: string): Promise<AutomationRun | null> {
  try {
    if (["backup", "backup-manual", "media-copy"].includes(ruleKey)) {
      // The advisory lock covers the concurrent RUNNING check AND the insert.
      // A second request cannot slip through while another caller is claiming.
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('backup-run'))`;
        if (ruleKey === "backup-manual") {
          if (!actorUserId) throw new Error("Owner sign-in required.");
          await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
        }
        const others = await tx.automationRun.findMany({
          where: { ruleKey: { in: ["backup", "backup-manual", "media-copy"] }, state: "RUNNING" },
          select: { startedAt: true, budgetSeconds: true },
        });
        if (ruleKey === "backup-manual") {
          // Two submissions carrying different request IDs still result in one
          // attempt on the same Colorado day, even when the first finishes quickly.
          const manualToday = await tx.automationRun.findMany({
            where: { ruleKey: "backup-manual" }, select: { startedAt: true },
            orderBy: { startedAt: "desc" }, take: 10,
          });
          if (manualToday.some(r => businessDateKey(r.startedAt) === businessDateKey(now))) return null;
        }
        if (others.some((r) => now.getTime() - r.startedAt.getTime() < r.budgetSeconds * 1000)) return null;
        const started = await tx.automationRun.create({
          data: { ruleKey, runKey, budgetSeconds, environment: environmentName(), startedAt: now },
        });
        if (ruleKey === "backup-manual") {
          await tx.auditLog.create({
            data: { userId: actorUserId, action: "backup.manual_run",
              entityType: "AutomationRun", entityId: started.id,
              newValue: { requested: true } },
          });
        }
        return started;
      }, { maxWait: 10_000, timeout: 20_000 });
    }
    return await prisma.automationRun.create({
      data: {
        ruleKey,
        runKey,
        budgetSeconds,
        environment: environmentName(),
        startedAt: now,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

const MAX_FAILED_RETRIES = 2;

async function claimRun(ruleKey: string, baseRunKey: string, budgetSeconds: number, now: Date, actorUserId?: string): Promise<AutomationRun | null> {
  let runKey = baseRunKey;
  let retry = 0;

  for (;;) {
    const created = await createRun(ruleKey, runKey, budgetSeconds, now, actorUserId);
    if (created) return created;

    const existing = await prisma.automationRun.findUnique({
      where: { ruleKey_runKey: { ruleKey, runKey } },
    });
    if (!existing) {
      if (["backup", "backup-manual", "media-copy"].includes(ruleKey)) return null;
      continue;
    }

    if (existing.state === "SUCCEEDED" || existing.state === "SKIPPED") return null;
    // A failed slot may be tried again on a later call the same day (at most twice), so one bad moment
    // does not cost the whole day's reminders. The owner still sees the failure on the System health page.
    if (existing.state === "FAILED" && retry >= MAX_FAILED_RETRIES) return null;

    const ageMs = now.getTime() - existing.startedAt.getTime();
    if (existing.state === "RUNNING" && ageMs < existing.budgetSeconds * 1000) return null;

    if (existing.state === "RUNNING") {
      const marked = await prisma.automationRun.updateMany({
        where: { id: existing.id, state: "RUNNING" },
        data: { state: "UNKNOWN", finishedAt: now, error: "Run exceeded its execution budget; outcome is unknown." },
      });
      if (marked.count === 0) continue;
    }

    retry += 1;
    runKey = `${baseRunKey}:retry${retry}`;
  }
}

export async function runAutomation(input: RunAutomationInput): Promise<RunAutomationResult> {
  const now = input.now ?? new Date();
  const budgetSeconds = input.budgetSeconds ?? 300;
  if (!input.ruleKey.trim()) throw new Error("ruleKey is required.");
  if (!Number.isInteger(budgetSeconds) || budgetSeconds < 1) throw new Error("budgetSeconds must be a positive integer.");

  if (input.runKeyOverride && (input.ruleKey !== "backup-manual" ||
      !/^manual:[0-9a-f-]{36}$/.test(input.runKeyOverride))) {
    throw new Error("Invalid manual backup run key.");
  }
  if (input.ruleKey === "backup-manual" && (!input.actorUserId || !input.runKeyOverride)) {
    throw new Error("Manual backup needs a verified owner and unique request.");
  }
  const baseRunKey = input.runKeyOverride ?? `${input.ruleKey}:${automationSlot(now)}`;

  if (await settingsPaused(input.ruleKey)) {
    const existing = await prisma.automationRun.findUnique({
      where: { ruleKey_runKey: { ruleKey: input.ruleKey, runKey: baseRunKey } },
    });
    if (existing) return { outcome: existing.state === "SKIPPED" ? "PAUSED" : "ALREADY_RAN", runId: existing.id };
    try {
      const skipped = await prisma.automationRun.create({
        data: {
          ruleKey: input.ruleKey,
          runKey: baseRunKey,
          state: "SKIPPED",
          environment: environmentName(),
          startedAt: now,
          finishedAt: now,
          budgetSeconds,
          counts: {},
          error: "Paused by owner.",
        },
      });
      return { outcome: "PAUSED", runId: skipped.id };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await prisma.automationRun.findUnique({
        where: { ruleKey_runKey: { ruleKey: input.ruleKey, runKey: baseRunKey } },
      });
      return { outcome: raced?.state === "SKIPPED" ? "PAUSED" : "ALREADY_RAN", runId: raced?.id ?? null };
    }
  }

  const run = await claimRun(input.ruleKey, baseRunKey, budgetSeconds, now, input.actorUserId);
  if (!run) {
    const latest = await prisma.automationRun.findFirst({
      where: { ruleKey: input.ruleKey, runKey: { startsWith: baseRunKey } },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    return { outcome: "ALREADY_RAN", runId: latest?.id ?? null };
  }

  try {
    const result = await input.work({ runId: run.id });
    const counts = validateCounts(result.counts);
    await prisma.automationRun.update({
      where: { id: run.id },
      data: { state: "SUCCEEDED", finishedAt: new Date(), counts, error: null },
    });
    if (input.ruleKey !== "system-issues-sweep") {
      await resolveSystemIssue("automation:" + input.ruleKey, "SOURCE_SUCCEEDED");
      await resolveSystemIssue("automation-stale:" + input.ruleKey, "SOURCE_SUCCEEDED");
    }
    return { outcome: "RAN", runId: run.id };
  } catch (cause) {
    const { code, stage } = classifyFailure(cause);
    const failureStage = stage ?? "work";
    const correlationId = newCorrelationId();
    // The private server log line carries the same reference as the screen, and only typed fields.
    console.error("[automation]", JSON.stringify({ rule: input.ruleKey, run: run.id, code, stage: failureStage, ref: correlationId }));
    await reportBackgroundError(cause, "automation:" + input.ruleKey, { ref: correlationId, code });
    await prisma.automationRun.update({
      where: { id: run.id },
      data: { state: "FAILED", finishedAt: new Date(), error: safeError(cause), failureCode: code, failureStage, correlationId },
    });
    if (input.ruleKey !== "system-issues-sweep") {
      const allowed = new Set(["Error", "TypeError", "TimeoutError", "AbortError", "FetchError", "PrismaClientKnownRequestError", "PrismaClientInitializationError", "TaxLookupUnavailable", "ProviderTimeoutError"]);
      const name = cause instanceof Error && allowed.has(cause.name) ? cause.name : "UnknownError";
      await recordSystemIssue({ kind: "AUTOMATION_FAILED", ruleKey: input.ruleKey,
        runId: run.id, startedAt: run.startedAt, errorName: name,
        failure: { code, stage: failureStage, correlationId } });
    }
    return { outcome: "FAILED", runId: run.id };
  }
}
