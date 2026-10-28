import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import { getBackupStore } from "@/lib/photo-storage";
import { sweepSystemIssues } from "@/domains/system-issues/sources";
import { AUTOMATION_RULES, setAutomationPaused } from "@/domains/automation/health";
import { operationBackupRunKey, retryBackupNow } from "@/domains/backup/manual";
import { runMediaInventoryAndCopy } from "@/domains/backup/media";
import { verifyBackupReadback } from "@/domains/backup/artifacts";
import { applyAnswers, getDecision, previewAnswers, type ParsedAnswer } from "@/domains/decisions";
import { decisionSubject } from "@/domains/decisions/registry";
import { matchOption } from "@/domains/decisions/rules";
import type { AgentContext } from "./authorization";
import { canonicalAgentArgs, type JournalAction, type JournalPreview } from "./journal";

const empty = z.object({}).strict();
const ruleArgs = z.object({ ruleKey: z.string().min(1).max(80).regex(/^[a-z0-9:-]+$/) }).strict();
const artifactArgs = z.object({ artifactId: z.string().min(12).max(80).regex(/^[a-zA-Z0-9_-]+$/) }).strict();
const mediaArgs = z.object({ databaseArtifactId: z.string().min(12).max(80).regex(/^[a-zA-Z0-9_-]+$/) }).strict();
const answerArgs = z.object({
  answers: z.array(z.object({
    code: z.string().min(1).max(30),
    option: z.unknown().refine((v) => v !== undefined),
    otherText: z.string().max(1000).nullish(),
    effectiveFrom: z.string().max(24).nullish(),
    explanation: z.string().max(1000).nullish(),
    answeredBy: z.string().max(150).nullish(),
    firm: z.string().max(150).nullish(),
    answeredOn: z.string().max(24).nullish(),
  }).strict()).min(1).max(200),
}).strict();

export type PreparedAgentAction = {
  args: Record<string, unknown>;
  targetRef: string;
  preview: JournalPreview;
  previewHash: string;
  verifyIntent: Record<string, unknown>;
};

/**
 * Parse with a CLOSED schema before either preview or execution. Nothing may smuggle
 * new argument fields, arbitrary URLs, SQL, commands, provider secrets or recipients.
 */
export function parseAgentAction(action: JournalAction, raw: unknown): Record<string, unknown> {
  switch (action) {
    case "RUN_DIAGNOSTIC_SWEEP":
    case "RETRY_DATABASE_BACKUP":
      return empty.parse(raw);
    case "PAUSE_AUTOMATION":
    case "RESUME_AUTOMATION":
      return ruleArgs.parse(raw);
    case "RETRY_MEDIA_COPY":
      return mediaArgs.parse(raw);
    case "VERIFY_RECOVERY_ARTIFACT":
      return artifactArgs.parse(raw);
    case "APPLY_DECISION_ANSWERS":
      return answerArgs.parse(raw);
    default:
      throw new Error("UNKNOWN_ACTION");
  }
}

function versionHash(action: JournalAction, args: Record<string, unknown>, version: unknown): string {
  return createHash("sha256").update(canonicalAgentArgs({ action, args, version }).serialized).digest("hex");
}

function pausedRules(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** A bounded, authoritative preview; no business write or provider request occurs here. */
export async function prepareAgentAction(
  ctx: AgentContext, action: JournalAction, raw: unknown,
): Promise<PreparedAgentAction> {
  const args = parseAgentAction(action, raw);
  let targetRef = "";
  let preview: JournalPreview;
  let version: unknown;
  let verifyIntent: Record<string, unknown>;

  switch (action) {
    case "RUN_DIAGNOSTIC_SWEEP": {
      const [count, recent] = await Promise.all([
        prisma.systemIssue.count(),
        prisma.systemIssue.findFirst({ orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
          select: { id: true, lastSeenAt: true, version: true } }),
      ]);
      targetRef = "system-issues";
      version = { count, recent: recent?.id ?? null, last: recent?.lastSeenAt.toISOString() ?? null,
        revision: recent?.version ?? null };
      preview = { summary: "Check system problems again", changes: [
        { label: "System problems", now: count + " recorded", after: "Checked again; no customer data changed" },
      ] };
      verifyIntent = { beforeCount: count };
      break;
    }
    case "RETRY_DATABASE_BACKUP": {
      const now = new Date();
      const prior = await prisma.automationRun.findFirst({
        where: { ruleKey: "backup", runKey: { startsWith: "backup:" + businessDateKey(now) } },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        select: { id: true, state: true, startedAt: true, budgetSeconds: true },
      });
      const retryable = prior?.state === "FAILED" || prior?.state === "UNKNOWN" ||
        (prior?.state === "RUNNING" && now.getTime() - prior.startedAt.getTime() >= prior.budgetSeconds * 1000);
      if (!retryable || !prior) throw new Error("BACKUP_NOT_ELIGIBLE_FOR_RETRY");
      targetRef = "backup";
      version = { id: prior.id, state: prior.state, startedAt: prior.startedAt.toISOString() };
      preview = { summary: "Retry the failed database backup", changes: [
        { label: "Backup", now: "Failed or uncertain", after: "Try one new copy and verify it" },
      ], costNote: "Uses the existing private backup storage. No paid capacity is enabled." };
      verifyIntent = { originalRunId: prior.id };
      break;
    }
    case "RETRY_MEDIA_COPY": {
      const databaseArtifactId = args.databaseArtifactId as string;
      const artifact = await prisma.backupArtifact.findUnique({ where: { id: databaseArtifactId },
        select: { id: true, kind: true, state: true, sha256: true, verifiedAt: true, prunedAt: true } });
      if (!artifact || artifact.kind !== "DATABASE" || artifact.state !== "VERIFIED" || artifact.prunedAt)
        throw new Error("DATABASE_BACKUP_NOT_VERIFIED");
      targetRef = artifact.id;
      version = { id: artifact.id, kind: artifact.kind, state: artifact.state, sha256: artifact.sha256,
        verifiedAt: artifact.verifiedAt?.toISOString() ?? null, prunedAt: null };
      preview = { summary: "Retry the photo inventory for a verified backup", changes: [
        { label: "Photo inventory", now: "Needs checking", after: "Copy missing private photos and check the inventory" },
      ], costNote: "Uses existing private photo and backup storage only." };
      verifyIntent = { databaseArtifactId: artifact.id };
      break;
    }
    case "PAUSE_AUTOMATION":
    case "RESUME_AUTOMATION": {
      const ruleKey = args.ruleKey as string;
      const rule = AUTOMATION_RULES.find((r) => r.ruleKey === ruleKey);
      if (!rule) throw new Error("UNKNOWN_AUTOMATION_RULE");
      const settings = await prisma.businessSettings.findUnique({ where: { id: "singleton" },
        select: { pausedAutomations: true } });
      const paused = pausedRules(settings?.pausedAutomations).includes(ruleKey);
      const desired = action === "PAUSE_AUTOMATION";
      targetRef = ruleKey;
      version = { ruleKey, paused };
      preview = { summary: (desired ? "Pause " : "Resume ") + rule.label, changes: [
        { label: rule.label, now: paused ? "Paused" : "Running on its schedule",
          after: desired ? "Paused" : "Running on its schedule" },
      ] };
      verifyIntent = { ruleKey, desired, expectedBefore: paused };
      break;
    }
    case "VERIFY_RECOVERY_ARTIFACT": {
      const artifact = await prisma.backupArtifact.findUnique({ where: { id: args.artifactId as string },
        select: { id: true, kind: true, state: true, sha256: true, pathname: true, prunedAt: true } });
      if (!artifact || artifact.state !== "VERIFIED" || artifact.prunedAt)
        throw new Error("BACKUP_ARTIFACT_NOT_VERIFIED");
      targetRef = artifact.id;
      version = { id: artifact.id, sha256: artifact.sha256, state: artifact.state, prunedAt: artifact.prunedAt };
      preview = { summary: "Check a private recovery file", changes: [
        { label: "Recovery file", now: "Marked verified", after: "Read the private file and check its hash" },
      ] };
      verifyIntent = { artifactId: artifact.id };
      break;
    }
    case "APPLY_DECISION_ANSWERS": {
      if (ctx.role !== "OWNER") throw new Error("OWNER_REQUIRED");
      const answers = args.answers as ParsedAnswer[];
      const rows = (await previewAnswers(ctx.userId, answers)).preview;
      if (rows.some((row) => row.status === "INVALID"))
        throw new Error("DECISION_ANSWER_INVALID");
      targetRef = "decisions";
      version = rows.map(({ code, now, after, status, effectiveFrom }) =>
        ({ code, now, after, status, effectiveFrom }));
      preview = { summary: "Apply the completed professional answers", changes: rows.map((row) => ({
        label: row.title.slice(0, 100), now: row.now.slice(0, 400),
        after: (row.status === "OTHER" ? "Record only — no setting change" : row.after).slice(0, 400),
      })) };
      verifyIntent = { answers: answers.map((answer) => {
        const code = answer.code.replace(/^DQ-/, "");
        const subject = decisionSubject(code);
        const value = answer.option === null ? null :
          subject ? matchOption(subject, answer.option)?.value : undefined;
        if (value === undefined) throw new Error("DECISION_ANSWER_INVALID");
        return { code, other: answer.option === null, expectedValue: value,
          effectiveFrom: answer.effectiveFrom || null };
      }) };
      break;
    }
    default:
      throw new Error("UNKNOWN_ACTION");
  }

  return { args, targetRef, preview, previewHash: versionHash(action, args, version), verifyIntent };
}

/**
 * Dispatch ONLY after the operation has been durably claimed under a connection,
 * role, scope, approval and preview recheck. Existing business commands keep all
 * their native access, audit and transaction rules.
 */
export async function dispatchAgentAction(
  ctx: AgentContext, action: JournalAction, raw: unknown, operationId: string,
): Promise<Record<string, unknown>> {
  const args = parseAgentAction(action, raw);
  switch (action) {
    case "RUN_DIAGNOSTIC_SWEEP": {
      const sweep = await sweepSystemIssues(new Date(), 100);
      return { opened: sweep.opened, resolved: sweep.resolved };
    }
    case "RETRY_DATABASE_BACKUP": {
      const run = await retryBackupNow(ctx.userId, operationId);
      return { outcome: run.outcome, runId: run.runId };
    }
    case "RETRY_MEDIA_COPY": {
      const media = await runMediaInventoryAndCopy({ databaseArtifactId: args.databaseArtifactId as string });
      return { copied: media.counts.copied ?? 0, completed: true };
    }
    case "PAUSE_AUTOMATION":
    case "RESUME_AUTOMATION": {
      const operation = await prisma.agentOperation.findUniqueOrThrow({
        where: { id: operationId }, select: { verifyIntent: true },
      });
      const expected = object(operation.verifyIntent).expectedBefore;
      if (typeof expected !== "boolean") throw new Error("PREVIEW_CHANGED");
      await setAutomationPaused(ctx.userId, args.ruleKey as string,
        action === "PAUSE_AUTOMATION", expected);
      return { updated: true };
    }
    case "VERIFY_RECOVERY_ARTIFACT": {
      const artifact = await prisma.backupArtifact.findUniqueOrThrow({ where: { id: args.artifactId as string } });
      if (artifact.prunedAt) throw new Error("RECOVERY_FILE_NO_LONGER_EXISTS");
      const store = getBackupStore();
      if (!store) throw new Error("BACKUP_STORE_NOT_READY");
      const verified = await verifyBackupReadback(artifact.pathname, store.token, artifact.sha256);
      if (!verified) throw new Error("RECOVERY_HASH_MISMATCH");
      return { verified: true };
    }
    case "APPLY_DECISION_ANSWERS": {
      const answers = args.answers as ParsedAnswer[];
      // Never persist a signed DEC-1 confirmation token in the journal or backup.
      // DEC-1 recreates its preview, consumes the new token inside its transaction
      // and rejects even a last-millisecond change to an answer or target setting.
      const operation = await prisma.agentOperation.findUniqueOrThrow({
        where: { id: operationId }, select: { previewHash: true },
      });
      // Recheck the persisted original preview after claim, before the native
      // DEC-1 compare-and-set. DEC-1 then guards the final transaction against races.
      const fresh = await prepareAgentAction(ctx, action, args);
      if (fresh.previewHash !== operation.previewHash) throw new Error("PREVIEW_CHANGED");
      const { preview, confirmToken } = await previewAnswers(ctx.userId, answers);
      const version = preview.map(({ code, now, after, status, effectiveFrom }) =>
        ({ code, now, after, status, effectiveFrom }));
      if (versionHash(action, args, version) !== operation.previewHash)
        throw new Error("PREVIEW_CHANGED");
      const applied = await applyAnswers(ctx.userId, answers, confirmToken, { via: "MCP", agentOperationId: operationId });
      return { applied: applied.applied, same: applied.same, other: applied.other, skipped: applied.skipped };
    }
    default:
      throw new Error("UNKNOWN_ACTION");
  }
}

export async function verifyAgentAction(
  ctx: AgentContext, action: JournalAction, rawIntent: unknown,
  operationId: string, startedAt: Date, safeResult: unknown,
): Promise<{ ok: boolean; observed: Record<string, unknown> }> {
  const intent = object(rawIntent);
  const result = object(safeResult);
  switch (action) {
    case "RUN_DIAGNOSTIC_SWEEP": {
      const count = await prisma.systemIssue.count();
      return { ok: typeof result.opened === "number" && typeof result.resolved === "number",
        observed: { issueCount: count, checked: Boolean(result.opened !== undefined) } };
    }
    case "RETRY_DATABASE_BACKUP": {
      const run = await prisma.automationRun.findUnique({
        where: { ruleKey_runKey: { ruleKey: "backup-manual", runKey: operationBackupRunKey(operationId) } },
        select: { id: true, state: true },
      });
      const artifact = run ? await prisma.backupArtifact.findFirst({
        where: { runId: run.id, kind: "DATABASE", state: "VERIFIED", verifiedAt: { gte: startedAt } },
        select: { id: true, verifiedAt: true }, orderBy: { verifiedAt: "desc" },
      }) : null;
      return { ok: Boolean(artifact), observed: { runState: run?.state ?? "NOT_FOUND",
        verifiedArtifact: Boolean(artifact) } };
    }
    case "RETRY_MEDIA_COPY": {
      const target = String(intent.databaseArtifactId ?? "");
      const media = await prisma.backupArtifact.findFirst({
        where: { databaseArtifactId: target, kind: "MEDIA_MANIFEST", state: "VERIFIED",
          verifiedAt: { gte: startedAt } }, select: { id: true }, orderBy: { verifiedAt: "desc" },
      });
      return { ok: Boolean(media), observed: { verifiedManifest: Boolean(media) } };
    }
    case "PAUSE_AUTOMATION":
    case "RESUME_AUTOMATION": {
      const settings = await prisma.businessSettings.findUnique({ where: { id: "singleton" },
        select: { pausedAutomations: true } });
      const paused = pausedRules(settings?.pausedAutomations).includes(String(intent.ruleKey ?? ""));
      return { ok: paused === (intent.desired === true), observed: { paused } };
    }
    case "VERIFY_RECOVERY_ARTIFACT": {
      const artifact = await prisma.backupArtifact.findUnique({ where: { id: String(intent.artifactId ?? "") } });
      const store = getBackupStore();
      const ok = Boolean(artifact && !artifact.prunedAt && artifact.state === "VERIFIED" && store &&
        await verifyBackupReadback(artifact.pathname, store.token, artifact.sha256));
      return { ok, observed: { hashMatched: ok } };
    }
    case "APPLY_DECISION_ANSWERS": {
      const answers = Array.isArray(intent.answers) ? intent.answers.map(object) : [];
      if (!answers.length) return { ok: false, observed: { verifiedAnswers: 0 } };
      let verified = 0;
      for (const answer of answers) {
        const code = String(answer.code ?? "");
        const record = await prisma.decisionRecord.findFirst({ where: {
          subjectId: code, kind: "PROFESSIONAL_ANSWER", via: "MCP",
          agentOperationId: operationId, createdAt: { gte: startedAt },
        }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        if (!record) continue;
        if (answer.other === true) {
          // "Other" is evidence, not an instruction to change a setting.
          if (record.value === null) verified++;
          continue;
        }
        if (record.value === null || answer.expectedValue === null || answer.expectedValue === undefined) continue;
        const recordDigest = canonicalAgentArgs({ value: record.value }).digest;
        if (recordDigest !== canonicalAgentArgs({ value: answer.expectedValue }).digest) continue;
        const effectiveFrom = typeof answer.effectiveFrom === "string" ? answer.effectiveFrom : null;
        const isFuture = !!effectiveFrom && effectiveFrom > businessDateKey(startedAt);
        if (isFuture) {
          const scheduled = await prisma.decisionScheduledChange.findFirst({ where: {
            decisionRecordId: record.id, subjectId: code, cancelledAt: null,
          }, select: { value: true, effectiveFrom: true } });
          if (!scheduled || businessDateKey(scheduled.effectiveFrom) !== effectiveFrom ||
              canonicalAgentArgs({ value: scheduled.value }).digest !== recordDigest) continue;
        } else {
          // A professional answer that should apply now must agree with the
          // actual current setting, not merely with the existence of a record.
          const current = await getDecision(ctx.userId, code);
          if (canonicalAgentArgs({ value: current.current.value }).digest !== recordDigest) continue;
        }
        verified++;
      }
      return { ok: verified === answers.length,
        observed: { verifiedAnswers: verified, expectedAnswers: answers.length } };
    }
    default:
      throw new Error("UNKNOWN_ACTION");
  }
}
