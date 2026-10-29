import { requireRole } from "@/lib/session";
import { getLeadsForExport } from "@/domains/leads/queue";
import type { LeadStage } from "@/domains/leads/stage";
import { getLeadResponseDays } from "@/domains/leads/follow-up";
import { leadNextStep } from "@/domains/leads/next-step";
import { formatShortDate } from "@/lib/business-date";
import { toCsv } from "@/lib/csv";
import { parseLeadsParams } from "../params";

const STAGE_WORDS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quote sent",
  won: "Won",
  lost: "Lost",
};

export const LEADS_EXPORT_MAX = 10_000;

/**
 * AR-4b (LEADS.md section 2): "Export leads (CSV)" — the queue's current
 * filtered list as a download, same columns as the desktop table, OWNER /
 * ADMIN only, at most 10,000 rows. `?ids=` (comma-joined, from the bulk
 * bar's "Export selected") narrows it to exactly those leads.
 */
export async function GET(request: Request) {
  const session = await requireRole("OWNER", "ADMIN");

  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const params = parseLeadsParams(raw);
  const { pm, ...queueParams } = params;
  const resolved = {
    ...queueParams,
    ...(pm ? { pm: true } : {}),
    ...(queueParams.owner === "me" ? { owner: session.user.id } : {}),
  };

  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, LEADS_EXPORT_MAX);

  const now = new Date();
  const [rows, responseDays] = await Promise.all([
    getLeadsForExport(resolved, LEADS_EXPORT_MAX),
    getLeadResponseDays(),
  ]);
  const shown = ids.length ? rows.filter((r) => ids.includes(r.id)) : rows;

  const csv = toCsv(
    [
      { key: "name", header: "Name" },
      { key: "wants", header: "Wants" },
      { key: "stage", header: "Stage" },
      { key: "score", header: "Score" },
      { key: "nextStep", header: "Next step" },
      { key: "owner", header: "Owner" },
      { key: "created", header: "Created" },
    ],
    shown.map((r) => ({
      name: r.contactName,
      wants: r.applianceSummary,
      stage: STAGE_WORDS[r.stage],
      score: r.score,
      nextStep: leadNextStep({ ...r, responseDays }, now).text,
      owner: r.assignedTo?.name ?? "Unassigned",
      created: formatShortDate(r.createdAt, now),
    })),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${now.toISOString().slice(0, 10)}.csv"`,
    },
  });
}
