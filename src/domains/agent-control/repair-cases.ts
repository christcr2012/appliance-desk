import { createHash } from "node:crypto";
import { RepairStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { assertNoKnownPersonNames, redactForOps } from "@/domains/system-issues/ops-redaction";

const REPO = "christcr2012/appliance-desk";
const API = "https://api.github.com/repos/" + REPO;
const SHA = /^[a-f0-9]{40}$/i;
const RULE = /^automation:([a-z0-9-]{2,70})$/;
const FINAL = new Set<RepairStage>(["VERIFIED", "REJECTED", "SUPERSEDED"]);
export type RepairSource = "SYSTEM_ISSUE" | "FEEDBACK";
export type RepairCaseInput = {
  actorId: string; sourceKind: RepairSource; sourceId: string;
  expectedBehavior: string; howToCheck: string;
};
export type RepairFetch = typeof fetch;
export class RepairEvidenceError extends Error {
  constructor(public readonly code: string) { super(code); }
}

function safe(value: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
    throw new RepairEvidenceError("INVALID_REPAIR_TEXT");
  const result = redactForOps(value.trim()).slice(0, max);
  // Redacted personal information must not silently pass as public repair instructions.
  if (result !== value.trim() || /\[private information removed\]|\[link removed\]/.test(result))
    throw new RepairEvidenceError("REPAIR_TEXT_CONTAINS_PRIVATE_DATA");
  return result;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Idempotent create. Actor authority, source existence and prohibited personal data are all checked in one TX. */
export async function createRepairCase(input: RepairCaseInput) {
  if (!["SYSTEM_ISSUE", "FEEDBACK"].includes(input.sourceKind) || !input.sourceId || input.sourceId.length > 128)
    throw new RepairEvidenceError("INVALID_REPAIR_SOURCE");
  const expectedBehavior = safe(input.expectedBehavior, 2000);
  const howToCheck = safe(input.howToCheck, 2000);
  if (input.sourceKind === "SYSTEM_ISSUE" && !RULE.test(howToCheck))
    throw new RepairEvidenceError("REPAIR_REQUIRES_NAMED_AUTOMATION_CHECK");
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, input.actorId, ["OWNER", "ADMIN"]);
    // Serialize on the real source row before checking active repairs.
    // The partial unique index remains the final concurrency safeguard.
    if (input.sourceKind === "SYSTEM_ISSUE") {
      await tx.$queryRaw`SELECT "id" FROM "SystemIssue" WHERE "id" = ${input.sourceId} FOR UPDATE`;
    } else {
      await tx.$queryRaw`SELECT "id" FROM "FeedbackReport" WHERE "id" = ${input.sourceId} FOR UPDATE`;
    }
    const issue = input.sourceKind === "SYSTEM_ISSUE"
      ? await tx.systemIssue.findUnique({ where: { id: input.sourceId } }) : null;
    const report = input.sourceKind === "FEEDBACK"
      ? await tx.feedbackReport.findUnique({ where: { id: input.sourceId } }) : null;
    if (!issue && !report) throw new RepairEvidenceError("REPAIR_SOURCE_NOT_FOUND");
    if (report && (report.contentRemovedAt || report.aiReview !== "OPTED_IN"))
      throw new RepairEvidenceError("REPORT_HAS_NO_AGENT_PERMISSION");
    const title = safe((issue?.summary ?? report?.title) || "Problem", 160);
    await assertNoKnownPersonNames(tx, [title, expectedBehavior, howToCheck].join(" "));
    const version = (issue?.version ?? report?.version) as number;
    const fingerprint = hash([input.sourceKind, input.sourceId, version, expectedBehavior].join(":"));
    const active = await tx.repairCase.findFirst({
      where: { sourceKind: input.sourceKind, sourceId: input.sourceId,
        stage: { notIn: ["VERIFIED", "REJECTED", "SUPERSEDED"] } },
    });
    if (active) return active;
    const existing = await tx.repairCase.findUnique({ where: { fingerprint } });
    if (existing) return existing;
    const baselineRevision = process.env.VERCEL_GIT_COMMIT_SHA;
    if (!baselineRevision || !SHA.test(baselineRevision))
      throw new RepairEvidenceError("REPAIR_SOURCE_REVISION_UNVERIFIED");
    // Atomic keyed upsert returns the SAME case under concurrent duplicate submissions.
    // The unique fingerprint is owned by Postgres, not an in-memory request cache.
    return tx.repairCase.upsert({
      where: { fingerprint },
      create: { sourceKind: input.sourceKind, sourceId: input.sourceId, sourceVersion: version,
        fingerprint, title, expectedBehavior, howToCheck, baselineRevision, createdByUserId: input.actorId },
      update: {},
    });
  });
}

/** Callers can only name an integer PR; all source URLs are constructed here, never from caller input. */
export async function linkRepairPullRequest(input: {
  actorId: string; caseId: string; prNumber: number; repository?: string;
}) {
  if (input.repository !== undefined && input.repository !== REPO) throw new RepairEvidenceError("FOREIGN_REPOSITORY");
  if (!Number.isSafeInteger(input.prNumber) || input.prNumber <= 0)
    throw new RepairEvidenceError("INVALID_PULL_REQUEST");
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, input.actorId, ["OWNER", "ADMIN"]);
    const record = await tx.repairCase.findUnique({ where: { id: input.caseId } });
    if (!record || FINAL.has(record.stage)) throw new RepairEvidenceError("REPAIR_CASE_NOT_OPEN");
    if (record.prNumber && record.prNumber !== input.prNumber)
      throw new RepairEvidenceError("REPAIR_PR_ALREADY_LINKED");
    if (!record.prNumber) {
      await tx.repairCase.update({ where: { id: record.id }, data: { prNumber: input.prNumber,
        stage: "IN_PROGRESS", version: { increment: 1 } } });
      await tx.repairEvidence.create({ data: { caseId: record.id, kind: "PR",
        ref: String(input.prNumber), status: "CANDIDATE" } });
    }
    return { caseId: record.id, prNumber: input.prNumber, stage: "IN_PROGRESS" as const };
  });
}

export async function listRepairCases(actorId: string, limit = 25) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new RepairEvidenceError("INVALID_REPAIR_LIMIT");
  await prisma.$transaction(async tx => { await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]); });
  return prisma.repairCase.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit,
    select: { id: true, number: true, title: true, sourceKind: true, sourceId: true, stage: true,
      blocker: true, prNumber: true, createdAt: true, updatedAt: true, verifiedAt: true },
  });
}
export async function getRepairCase(actorId: string, caseId: string) {
  await prisma.$transaction(async tx => { await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]); });
  return prisma.repairCase.findUnique({ where: { id: caseId },
    include: { evidence: { orderBy: { createdAt: "desc" }, take: 30 } } });
}

/** Fixed-origin GitHub read. No user URLs, redirects, credentials, or unbounded responses. */
export async function fetchGitHubEvidence<T>(path: string, fetcher: RepairFetch = fetch): Promise<T> {
  if (!/^\/(?:pulls\/[1-9]\d{0,9}|commits\/[a-f0-9]{40}\/check-runs|compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40})$/i.test(path))
    throw new RepairEvidenceError("INVALID_GITHUB_EVIDENCE_PATH");
  let response: Response;
  try {
    response = await fetcher(API + path, { redirect: "error", credentials: "omit",
      cache: "no-store", headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new RepairEvidenceError("GITHUB_EVIDENCE_UNAVAILABLE");
  }
  if (response.status !== 200 || response.redirected || !response.body)
    throw new RepairEvidenceError("GITHUB_EVIDENCE_NOT_VERIFIED");
  const claimedLength = Number(response.headers.get("content-length") ?? 0);
  if (!Number.isFinite(claimedLength) || claimedLength > 1_000_000)
    throw new RepairEvidenceError("GITHUB_EVIDENCE_TOO_LARGE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1_000_000) throw new RepairEvidenceError("GITHUB_EVIDENCE_TOO_LARGE");
      chunks.push(value);
    }
    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(combined)) as T;
  } catch (error) {
    if (error instanceof RepairEvidenceError) throw error;
    throw new RepairEvidenceError("GITHUB_EVIDENCE_INVALID");
  } finally {
    reader.releaseLock();
  }
}

type GitHubPr = { number?: number; state?: string; merged_at?: string | null;
  merge_commit_sha?: string | null; base?: { ref?: string }; head?: { repo?: { full_name?: string } } };
type CheckResponse = { check_runs?: Array<{ name?: string; conclusion?: string;
  status?: string; head_sha?: string }> };
type CompareResponse = { status?: string; ahead_by?: number };

/** Rechecks live facts. An unverified or failed observation NEVER claims a successful fix. */
export async function checkRepairCase(
  actorId: string, caseId: string,
  options: { fetcher?: RepairFetch; deployedRevision?: string } = {},
) {
  await prisma.$transaction(async tx => { await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]); });
  const record = await prisma.repairCase.findUnique({ where: { id: caseId } });
  if (!record) throw new RepairEvidenceError("REPAIR_CASE_NOT_FOUND");
  if (FINAL.has(record.stage)) return record;
  if (!record.prNumber) return record;
  const fetcher = options.fetcher ?? fetch;
  let stage: RepairStage = "BLOCKED";
  let blocker: string | null = null;
  let mergeSha: string | null = null;
  let deployedRevision: string | null = null;
  const evidence: Array<{ kind: string; ref: string; status: string; verifier: string; detail: object }> = [];
  try {
    const pull = await fetchGitHubEvidence<GitHubPr>(`/pulls/${record.prNumber}`, fetcher);
    if (pull.number !== record.prNumber || pull.base?.ref !== "main" ||
      pull.head?.repo?.full_name !== REPO) throw new RepairEvidenceError("PR_NOT_IN_ALLOWED_REPOSITORY");
    stage = "PR_OPEN";
    evidence.push({ kind: "PR", ref: String(record.prNumber), status: "VERIFIED",
      verifier: "github-public-api", detail: { stage } });
    if (pull.merged_at && pull.merge_commit_sha && SHA.test(pull.merge_commit_sha)) {
      mergeSha = pull.merge_commit_sha.toLowerCase();
      const checks = await fetchGitHubEvidence<CheckResponse>(`/commits/${mergeSha}/check-runs`, fetcher);
      if (!checks.check_runs?.some(c => c.name === "ci" && c.status === "completed" &&
          c.conclusion === "success" && c.head_sha?.toLowerCase() === mergeSha))
        throw new RepairEvidenceError("EXACT_MERGE_COMMIT_CI_NOT_VERIFIED");
      stage = "MERGED";
      evidence.push({ kind: "CHECK", ref: mergeSha, status: "VERIFIED",
        verifier: "github-public-api", detail: { check: "ci", stage } });
      const deployed = options.deployedRevision ?? process.env.VERCEL_GIT_COMMIT_SHA;
      if (!deployed || !SHA.test(deployed)) throw new RepairEvidenceError("LIVE_DEPLOYMENT_UNVERIFIED");
      if (deployed.toLowerCase() !== mergeSha) {
        const comparison = await fetchGitHubEvidence<CompareResponse>(
          `/compare/${mergeSha}...${deployed.toLowerCase()}`, fetcher);
        if (comparison.status !== "ahead" && comparison.status !== "identical")
          throw new RepairEvidenceError("MERGE_NOT_IN_RUNNING_APPLICATION");
      }
      deployedRevision = deployed.toLowerCase();
      stage = "DEPLOYED";
      evidence.push({ kind: "DEPLOYMENT", ref: deployedRevision, status: "VERIFIED",
        verifier: "running-app", detail: { ancestor: mergeSha } });
      if (record.sourceKind === "SYSTEM_ISSUE") {
        const rule = RULE.exec(record.howToCheck)?.[1];
        if (!rule) throw new RepairEvidenceError("REPAIR_RUNTIME_TEST_UNDEFINED");
        const [issue, priorDeployment, run] = await Promise.all([
          prisma.systemIssue.findUnique({ where: { id: record.sourceId } }),
          prisma.repairEvidence.findFirst({ where: { caseId, kind: "DEPLOYMENT", status: "VERIFIED" },
            orderBy: { checkedAt: "asc" } }),
          prisma.automationRun.findFirst({ where: { ruleKey: rule, state: "SUCCEEDED" },
            orderBy: { startedAt: "desc" } }),
        ]);
        // A successful run for an unrelated rule is not evidence that this
        // issue was fixed. Only the issue's own automation fingerprint can
        // be verified through this rule; other kinds require a specific check.
        if (issue?.kind !== "AUTOMATION_FAILED" || issue.fingerprint !== `automation:${rule}`)
          throw new RepairEvidenceError("REPAIR_CHECK_NOT_LINKED_TO_SOURCE");
        // A check must happen AFTER a prior, independently observed deployed state.
        if (!priorDeployment?.checkedAt || !run || run.startedAt <= priorDeployment.checkedAt ||
          issue?.status !== "RESOLVED")
          throw new RepairEvidenceError("INDEPENDENT_RUNTIME_CHECK_NOT_PASSED");
        stage = "VERIFIED";
        evidence.push({ kind: "RUNTIME_CHECK", ref: rule, status: "VERIFIED",
          verifier: "health-rule", detail: { runId: run.id, checkedAfter: priorDeployment.checkedAt.toISOString() } });
      } else {
        // Feedback confirmations are handled by the separately consent-checked MCP-11 workflow.
        blocker = "Waiting for the reporter to check the fix.";
      }
    }
  } catch (error) {
    blocker = error instanceof RepairEvidenceError ? error.code : "UNVERIFIED_REPAIR_EVIDENCE";
  }
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const prior = await tx.repairCase.findUnique({ where: { id: caseId } });
    if (!prior || FINAL.has(prior.stage)) return prior;
    const updated = await tx.repairCase.updateMany({ where: { id: caseId, version: prior.version },
      data: { stage: stage === "BLOCKED" && prior.stage === "DEPLOYED" ? "DEPLOYED" : stage,
        blocker, mergeSha: mergeSha ?? prior.mergeSha,
        deployedRevision: deployedRevision ?? prior.deployedRevision,
        verifiedAt: stage === "VERIFIED" ? new Date() : null, version: { increment: 1 } } });
    if (updated.count !== 1) throw new RepairEvidenceError("REPAIR_VERSION_CHANGED");
    for (const item of evidence) {
      await tx.repairEvidence.create({ data: { caseId, kind: item.kind, ref: item.ref,
        status: item.status, verifier: item.verifier, checkedAt: new Date(), detail: item.detail } });
    }
    return tx.repairCase.findUniqueOrThrow({ where: { id: caseId } });
  });
}

export async function stopRepairCase(actorId: string, caseId: string,
  state: "REJECTED" | "SUPERSEDED", reason: string) {
  const blocker = safe(reason, 500);
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const record = await tx.repairCase.findUnique({ where: { id: caseId } });
    if (!record || FINAL.has(record.stage)) throw new RepairEvidenceError("REPAIR_CASE_NOT_OPEN");
    return tx.repairCase.update({ where: { id: caseId }, data: { stage: state, blocker,
      version: { increment: 1 } } });
  });
}
