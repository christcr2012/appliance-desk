import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { todoTitle } from "@/domains/feedback/rules";
import type { ExceptionItem } from "./rules";

type Rows = { rows: ExceptionItem[]; total: number };

const OPEN = ["SUBMITTED", "TRIAGED", "NEEDS_INFORMATION", "ACCEPTED", "IN_PROGRESS", "AWAITING_VERIFICATION"] as const;

/** MCP-10a: app feedback waiting for the team (a new report, or the sender answered). Owner and admins only. */
export async function listFeedbackWaiting(limit: number): Promise<Rows> {
  await requireRole("OWNER", "ADMIN");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("A bounded task limit is required.");
  const where = { awaitingTeam: true, state: { in: [...OPEN] }, contentRemovedAt: null };
  const reports = await prisma.feedbackReport.findMany({
    where,
    select: { id: true, number: true, title: true, state: true, updatedAt: true },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  return {
    rows: reports.map((report): ExceptionItem => ({
      category: "FEEDBACK_WAITING",
      severity: "medium",
      title: todoTitle(report.number, report.title),
      detail: report.state === "SUBMITTED" ? "New" : "They answered",
      href: "/desk/feedback/" + encodeURIComponent(report.id),
      since: report.updatedAt,
    })),
    total: reports.length < limit ? reports.length : await prisma.feedbackReport.count({ where }),
  };
}
