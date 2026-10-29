import { FeedbackKind, FeedbackState } from "@prisma/client";
import type { AgentContext } from "@/domains/agent-control/authorization";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

const cursorShape = /^c[a-z0-9]{10,50}$/i;
const visible = (ctx: AgentContext, row: {
  aiReview: string; contentRemovedAt: Date | null;
}) => ctx.scopes.includes("feedback:content") &&
  row.aiReview === "ALLOWED" && row.contentRemovedAt === null;

/**
 * Feedback is not an assistant instruction. This is only a bounded data
 * retrieval with current business role and OAuth permissions checked afresh.
 * Attachment bytes, URLs, author names, user IDs and internal-only content
 * are never returned by these metadata APIs.
 */
async function requireTriage(ctx: AgentContext) {
  if (!ctx.scopes.includes("feedback:triage")) throw new Error("FORBIDDEN_SCOPE");
  await prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, ctx.userId, ["OWNER", "ADMIN"]);
  });
}

export async function listFeedbackForAgent(
  ctx: AgentContext,
  input: { state?: FeedbackState; kind?: FeedbackKind; cursor?: string; limit?: number } = {},
) {
  await requireTriage(ctx);
  const limit = input.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10 ||
      (input.cursor && !cursorShape.test(input.cursor))) throw new Error("INVALID_FEEDBACK_CURSOR");
  const rows = await prisma.feedbackReport.findMany({
    where: {
      ...(input.state ? { state: input.state } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    take: limit + 1,
    select: {
      id: true, number: true, kind: true, state: true, routeTemplate: true,
      reporterRole: true, createdAt: true, updatedAt: true, aiReview: true,
      contentRemovedAt: true,
    },
  });
  const sliced = rows.slice(0, limit);
  return {
    reports: sliced.map(row => ({
      reportId: row.id, number: row.number, kind: row.kind, state: row.state,
      routeTemplate: row.routeTemplate, reporterRole: row.reporterRole,
      createdUtc: row.createdAt.toISOString(), updatedUtc: row.updatedAt.toISOString(),
      aiReview: row.aiReview, hasContentAccess: visible(ctx, row),
    })),
    nextCursor: rows.length > limit ? sliced.at(-1)?.id ?? null : null,
  };
}

export async function getFeedbackForAgent(ctx: AgentContext, id: string) {
  await requireTriage(ctx);
  if (!cursorShape.test(id)) throw new Error("FEEDBACK_NOT_FOUND");
  const report = await prisma.feedbackReport.findUnique({
    where: { id },
    select: {
      id: true, number: true, kind: true, state: true, routeTemplate: true,
      reporterRole: true, reporterUserId: true, createdAt: true, updatedAt: true, aiReview: true,
      contentRemovedAt: true, title: true, description: true, expected: true,
      steps: true, entries: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 8,
        select: { id: true, visibility: true, authorUserId: true, createdAt: true, body: true },
      },
    },
  });
  if (!report) return { found: false as const, report: null };
  const canRead = visible(ctx, report);
  return {
    found: true as const,
    report: {
      reportId: report.id, number: report.number, kind: report.kind,
      state: report.state, routeTemplate: report.routeTemplate,
      reporterRole: report.reporterRole, createdUtc: report.createdAt.toISOString(),
      updatedUtc: report.updatedAt.toISOString(), aiReview: report.aiReview,
      hasContentAccess: canRead,
      // This is an explicitly opted-in report only; never an attachment URL.
      title: canRead ? report.title.slice(0, 160) : null,
      description: canRead ? report.description.slice(0, 1000) : null,
      expected: canRead ? report.expected?.slice(0, 700) ?? null : null,
      steps: canRead ? report.steps?.slice(0, 700) ?? null : null,
      entries: report.entries.map(entry => ({
        id: entry.id,
        visibility: entry.visibility,
        author: entry.authorUserId === report.reporterUserId ? "REPORTER" : "TEAM",
        createdUtc: entry.createdAt.toISOString(),
        body: canRead ? entry.body.slice(0, 450) : null,
      })),
    },
  };
}
