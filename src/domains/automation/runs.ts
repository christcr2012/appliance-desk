import { Prisma, type AutomationRun } from "@prisma/client";
import { businessDateKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";

export type AutomationOutcome = "RAN" | "ALREADY_RAN" | "FAILED" | "PAUSED";

export type RunAutomationInput = {
  ruleKey: string;
  now?: Date;
  budgetSeconds?: number;
  work: () => Promise<{ counts: Record<string, number> }>;
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

function safeError(cause: unknown): string {
  const raw = cause instanceof Error ? `${cause.name}: ${cause.message}` : "Unknown automation failure";
  return raw
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]+\b/g, "[secret]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]")
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

async function createRun(ruleKey: string, runKey: string, budgetSeconds: number, now: Date): Promise<AutomationRun | null> {
  try {
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

async function claimRun(ruleKey: string, baseRunKey: string, budgetSeconds: number, now: Date): Promise<AutomationRun | null> {
  let runKey = baseRunKey;
  let retry = 0;

  for (;;) {
    const created = await createRun(ruleKey, runKey, budgetSeconds, now);
    if (created) return created;

    const existing = await prisma.automationRun.findUnique({
      where: { ruleKey_runKey: { ruleKey, runKey } },
    });
    if (!existing) continue;

    if (existing.state === "SUCCEEDED" || existing.state === "FAILED" || existing.state === "SKIPPED") {
      return null;
    }

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

  const baseRunKey = `${input.ruleKey}:${automationSlot(now)}`;

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

  const run = await claimRun(input.ruleKey, baseRunKey, budgetSeconds, now);
  if (!run) {
    const latest = await prisma.automationRun.findFirst({
      where: { ruleKey: input.ruleKey, runKey: { startsWith: baseRunKey } },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    return { outcome: "ALREADY_RAN", runId: latest?.id ?? null };
  }

  try {
    const result = await input.work();
    const counts = validateCounts(result.counts);
    await prisma.automationRun.update({
      where: { id: run.id },
      data: { state: "SUCCEEDED", finishedAt: new Date(), counts, error: null },
    });
    return { outcome: "RAN", runId: run.id };
  } catch (cause) {
    await prisma.automationRun.update({
      where: { id: run.id },
      data: { state: "FAILED", finishedAt: new Date(), error: safeError(cause) },
    });
    return { outcome: "FAILED", runId: run.id };
  }
}
