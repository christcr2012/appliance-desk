import { SystemIssueStatus, type SystemIssueSeverity } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { assertNoKnownPersonNames, redactForOps } from "./ops-redaction";

export type SystemIssueDTO = {
  id: string; fingerprint: string; kind: string; severity: SystemIssueSeverity;
  status: SystemIssueStatus; version: number; summary: string; detail: string;
  occurrences: number; firstSeenAt: Date; lastSeenAt: Date;
  resolvedAt: Date | null;
  notes: { body: string; createdAt: Date }[];
  recovery: { href: string; instruction: string; role: "OWNER" | "ADMIN" };
};

const INSTRUCTIONS: Record<string, { href: string; instruction: string; role: "OWNER" | "ADMIN" }> = {
  AUTOMATION_FAILED: { href: "/desk/automations", instruction: "Review the last run and task settings before trying again.", role: "ADMIN" },
  AUTOMATION_STALE: { href: "/desk/automations", instruction: "UNKNOWN: verify the task's last successful run and expected schedule.", role: "ADMIN" },
  PROVIDER_OPERATION_STUCK: { href: "/desk/billing", instruction: "UNKNOWN provider result: reconcile the original operation before retrying. Never resend blindly.", role: "OWNER" },
  TAX_LOOKUP_UNAVAILABLE: { href: "/desk/sales-tax/setup", instruction: "Verify Colorado tax locations from official evidence; do not guess.", role: "OWNER" },
  SOURCE_PAGE_UNREACHABLE: { href: "/desk/sales-tax/setup", instruction: "Check the configured official source manually before making tax changes.", role: "OWNER" },
  SOURCE_PAGE_CHANGED: { href: "/desk/sales-tax/setup", instruction: "Review the official-source change before updating rates.", role: "OWNER" },
  TAX_RATE_GUARDRAIL: { href: "/desk/sales-tax", instruction: "Review the official rate evidence and the rejected automatic decision.", role: "OWNER" },
  MESSAGE_DELIVERY_UNKNOWN: { href: "/desk/automations", instruction: "UNKNOWN delivery: verify provider evidence before considering any resend.", role: "OWNER" },
  CONFIGURATION_MISSING: { href: "/desk/automations", instruction: "Check required environment variable names. Never paste secret values here.", role: "OWNER" },
};

export function systemIssueRecovery(kind: string, viewer: "OWNER" | "ADMIN") {
  const item = INSTRUCTIONS[kind];
  if (!item) return { href: "/desk/automations", instruction: "Manual investigation required; source not identified.", role: "ADMIN" as const };
  if (viewer === "ADMIN" && item.role === "OWNER")
    return { href: "/desk/automations", instruction: "Owner action needed. Ask the owner to investigate.", role: "OWNER" as const };
  return item;
}

async function requireIssueReader(actorId: string): Promise<"OWNER" | "ADMIN"> {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true, archivedAt: true } });
  if (!actor || actor.archivedAt || !["OWNER", "ADMIN"].includes(actor.role)) throw new Error("You cannot view system health.");
  return actor.role as "OWNER" | "ADMIN";
}

export async function listSystemIssues(actorId: string, input: {
  status?: SystemIssueStatus; cursor?: string; limit: number;
}): Promise<{ rows: SystemIssueDTO[]; nextCursor: string | null }> {
  const role = await requireIssueReader(actorId);
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
    throw new Error("Invalid issue page size.");
  if (input.status && !Object.values(SystemIssueStatus).includes(input.status))
    throw new Error("Invalid issue status.");
  if (input.cursor && !/^c[a-z0-9]{10,50}$/i.test(input.cursor))
    throw new Error("Invalid issue cursor.");
  const list = await prisma.systemIssue.findMany({
    where: input.status ? { status: input.status } : undefined,
    orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true, fingerprint: true, kind: true, severity: true, status: true,
      version: true, summary: true, detail: true, occurrences: true,
      firstSeenAt: true, lastSeenAt: true, resolvedAt: true,
      notes: { orderBy: { createdAt: "desc" }, take: 10, select: { body: true, createdAt: true } },
    },
  });
  return {
    rows: list.slice(0, input.limit).map((row) => ({ ...row, recovery: systemIssueRecovery(row.kind, role) })),
    nextCursor: list.length > input.limit ? list[input.limit - 1].id : null,
  };
}

function validateIssueMutation(issueId: string, expectedVersion: number): void {
  if (!/^c[a-z0-9]{10,50}$/i.test(issueId) || !Number.isInteger(expectedVersion) || expectedVersion < 1)
    throw new Error("Invalid issue reference or version.");
}

export async function addOwnerSystemIssueNote(actorId: string, input: {
  issueId: string; body: string; expectedVersion: number;
}): Promise<void> {
  validateIssueMutation(input.issueId, input.expectedVersion);
  const body = redactForOps(input.body).trim();
  if (!body) throw new Error("Please provide a note.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "SystemIssue" WHERE "id" = ${input.issueId} FOR UPDATE
    `;
    if (!locked.length) throw new Error("Issue not found.");
    const issue = await tx.systemIssue.findUniqueOrThrow({
      where: { id: input.issueId }, select: { version: true, status: true },
    });
    if (issue.version !== input.expectedVersion)
      throw new Error("This issue changed. Refresh before saving.");
    await assertNoKnownPersonNames(tx, body);
    const result = await tx.systemIssue.updateMany({
      where: { id: input.issueId, version: input.expectedVersion },
      data: { version: { increment: 1 },
        ...(issue.status === "OPEN" ? { status: "ACKNOWLEDGED" } : {}) },
    });
    if (result.count !== 1) throw new Error("This issue changed. Refresh before saving.");
    await tx.systemIssueNote.create({ data: { issueId: input.issueId, authorUserId: actorId, body } });
  });
}

export async function markSystemIssueResolved(actorId: string, input: {
  issueId: string; reason: string; expectedVersion: number;
}): Promise<void> {
  validateIssueMutation(input.issueId, input.expectedVersion);
  const reason = redactForOps(input.reason).trim();
  if (!reason) throw new Error("Please provide a resolution reason.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const row = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "SystemIssue" WHERE "id" = ${input.issueId} FOR UPDATE
    `;
    if (!row.length) throw new Error("Issue not found.");
    await assertNoKnownPersonNames(tx, reason);
    const result = await tx.systemIssue.updateMany({
      where: { id: input.issueId, version: input.expectedVersion, status: { not: "RESOLVED" } },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedReason: reason, version: { increment: 1 } },
    });
    if (result.count !== 1) throw new Error("This issue changed. Refresh before resolving.");
  });
}
