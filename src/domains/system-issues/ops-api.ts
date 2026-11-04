import { existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";
import { verifyOpsAgentKey } from "./ops-auth";
import {
  OPS_NOTE_CATEGORIES, OPS_RATE_LIMIT, OPS_RECOMMENDATIONS, type OpsRecommendationKey,
} from "./ops-contract";
import { failureExplanation } from "@/domains/automation/failures";

// The note categories, fixed recommendations and rate limit live in
// ops-contract.ts — the same module the hand-off block and the keyless
// discovery document publish — so enforcement and publication cannot drift.

export class OpsRequestError extends Error {
  constructor(public readonly status: number) { super("Invalid check-up request."); }
}

export async function authorizeOpsRequest(header: string | null) {
  if (!header?.startsWith("Bearer ")) throw new OpsRequestError(404);
  const key = await verifyOpsAgentKey(header.slice(7));
  if (!key) throw new OpsRequestError(404);
  if (await isRateLimited(`ops-checkup:${key.id}`, OPS_RATE_LIMIT))
    throw new OpsRequestError(429);
  return key;
}

/** Agent contract intentionally excludes notes, user IDs, reasons and raw provider failures. */
export async function getOpsIssues(input: { cursor?: string; limit: number }) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100 ||
      (input.cursor && !/^c[a-z0-9]{10,50}$/i.test(input.cursor))) throw new OpsRequestError(422);
  const rows = await prisma.systemIssue.findMany({
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
    select: { id: true, kind: true, severity: true, status: true, version: true,
      summary: true, detail: true, occurrences: true, firstSeenAt: true, lastSeenAt: true,
      resolvedAt: true, failureCode: true },
  });
  // MCP-1: the failure code and its fixed explanation only — never the stage, the log reference or any raw text.
  return { issues: rows.slice(0, input.limit).map(({ failureCode, ...row }) => {
      const plain = failureExplanation(failureCode);
      return { ...row, failureCode: plain.code, failureExplanation: row.kind === "AUTOMATION_FAILED" ? plain.explain : null };
    }),
    nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.id : null };
}

export function parseStructuredAgentNote(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new OpsRequestError(422);
  const data = input as Record<string, unknown>;
  const category = data.category;
  const codeReferences = data.codeReferences;
  const recommendationKey = data.recommendationKey;
  const expectedVersion = data.expectedVersion;
  const prUrl = data.prUrl;
  if (Object.keys(data).some(k => !["category", "codeReferences", "recommendationKey", "expectedVersion", "prUrl"].includes(k)) ||
    !OPS_NOTE_CATEGORIES.some(c => c === category) ||
    !Array.isArray(codeReferences) || codeReferences.length > 5 ||
    !(typeof recommendationKey === "string" && Object.prototype.hasOwnProperty.call(OPS_RECOMMENDATIONS, recommendationKey)) ||
    !Number.isInteger(expectedVersion) || (expectedVersion as number) < 1 ||
    (prUrl !== undefined && (typeof prUrl !== "string" ||
      !/^https:\/\/github\.com\/christcr2012\/appliance-desk\/pull\/[1-9]\d{0,8}$/.test(prUrl))))
      throw new OpsRequestError(422);
  const paths: string[] = [];
  for (const file of codeReferences) {
    if (typeof file !== "string" || file.length > 180 ||
      !/^(src|docs|tests|e2e|prisma|scripts)\/[A-Za-z0-9_/.-]+$/.test(file) ||
      file.split("/").some(part => part === ".." || part.startsWith(".")))
      throw new OpsRequestError(422);
    // Validation only (the file is never read or bundled): keep Turbopack from tracing the whole project.
    const full = resolve(/*turbopackIgnore: true*/ process.cwd(), file);
    if (!full.startsWith(process.cwd() + sep) || !existsSync(full) || !lstatSync(full).isFile() || !realpathSync(full).startsWith(process.cwd() + sep))
      throw new OpsRequestError(422);
    paths.push(file);
  }
  const body = [
    `${category}: ${OPS_RECOMMENDATIONS[recommendationKey as OpsRecommendationKey]}`,
    ...(paths.length ? [`Code: ${paths.join(", ")}`] : []),
    ...(prUrl ? [`PR: ${prUrl}`] : []),
  ].join("\n");
  return { body, expectedVersion: expectedVersion as number };
}

export async function addStructuredAgentNote(
  keyId: string, issueId: string, input: unknown,
): Promise<void> {
  if (!/^c[a-z0-9]{10,50}$/i.test(issueId)) throw new OpsRequestError(422);
  const { body, expectedVersion } = parseStructuredAgentNote(input);
  await prisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "SystemIssue" WHERE "id" = ${issueId} FOR UPDATE
    `;
    if (!locked.length) throw new OpsRequestError(404);
    const changed = await tx.systemIssue.updateMany({
      where: { id: issueId, version: expectedVersion },
      data: { version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new OpsRequestError(409);
    const original = await tx.systemIssue.findUniqueOrThrow({ where: { id: issueId }, select: { status: true } });
    if (original.status === "OPEN") {
      await tx.systemIssue.update({ where: { id: issueId }, data: { status: "ACKNOWLEDGED" } });
    }
    await tx.systemIssueNote.create({ data: { issueId, authorKeyId: keyId, body } });
  });
}
