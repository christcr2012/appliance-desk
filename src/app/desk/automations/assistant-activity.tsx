import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { AssistantActivityControls } from "./assistant-activity-controls";

const labels: Record<string, string> = {
  PREVIEWED: "Ready to approve in your conversation",
  AWAITING_APPROVAL: "Waiting for you", AUTHORIZED: "Approved",
  RUNNING: "Working", SUCCEEDED: "Done", FAILED: "Didn't work",
  UNKNOWN: "Not sure — check", DENIED: "Declined", CANCELLED: "Cancelled", EXPIRED: "Expired",
};

function safePreview(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const changes = Array.isArray(item.changes) ? item.changes.filter((value): value is {
    label: string; now: string; after: string;
  } => !!value && typeof value === "object" && ["label", "now", "after"].every(key =>
    typeof (value as Record<string, unknown>)[key] === "string")).slice(0, 200) : [];
  return {
    summary: typeof item.summary === "string" ? item.summary.slice(0, 250) : "Assistant action",
    costNote: typeof item.costNote === "string" ? item.costNote.slice(0, 300) : null,
    changes,
  };
}

export async function AssistantActivity({
  userId, canSeeAll, cursor,
}: { userId: string; canSeeAll: boolean; cursor?: string }) {
  const page = await prisma.agentOperation.findMany({
    where: canSeeAll ? {} : { connection: { userId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 26, ...(cursor && /^c[a-z0-9]{10,70}$/i.test(cursor)
      ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true, state: true, action: true, targetRef: true, createdAt: true,
      finishedAt: true, preview: true, verification: true,
      connection: { select: { label: true, userId: true, user: { select: { name: true } } } },
    },
  });
  const rows = page.slice(0, 25), next = page[25] ? rows.at(-1)?.id : null;
  return (
    <section id="assistant-activity" aria-labelledby="assistant-activity-heading"
      className="mb-6 rounded-card border border-line bg-surface p-4">
      <h2 id="assistant-activity-heading" className="text-base font-bold text-ink">Assistant activity</h2>
      <p className="mt-2 text-sm text-ink-soft">
        Check what your assistants asked to do, approve or decline a waiting change, and see verified results.
        Uncertain work never runs again automatically.
      </p>
      {!rows.length ? <p className="mt-3 text-sm">No assistant actions yet.</p> : (
        <ul className="mt-3 space-y-3">
          {rows.map((operation) => {
            const preview = safePreview(operation.preview);
            const observed = operation.verification as Record<string, unknown> | null;
            return (
              <li key={operation.id} className="rounded-field border border-line p-3">
                <p className="font-bold text-ink">{preview?.summary ?? operation.action.replaceAll("_", " ").toLowerCase()}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {formatBusinessDate(operation.createdAt)} at {formatBusinessTime(operation.createdAt)} — {operation.connection.label}
                  {" · "}{labels[operation.state] ?? "Not known"}
                </p>
                {canSeeAll && operation.connection.userId !== userId ?
                  <p className="text-sm text-ink-soft">Connected by {operation.connection.user.name ?? "another team member"}</p> : null}
                {operation.state === "SUCCEEDED" && observed ?
                  <p className="mt-2 text-sm text-ink-soft">Checked against the app on {typeof observed.checkedAt === "string"
                    ? observed.checkedAt.slice(0, 10) : "the completion date"}.</p> : null}
                {operation.state === "UNKNOWN" ?
                  <p className="mt-2 text-sm text-ink-soft">This action may have changed something. Check the affected item on System health before deciding what to do next.</p> : null}
                {canSeeAll && operation.state === "AWAITING_APPROVAL" && preview ?
                  <AssistantActivityControls operationId={operation.id} summary={preview.summary}
                    costNote={preview.costNote} changes={preview.changes} /> : null}
              </li>
            );
          })}
        </ul>
      )}
      {next ? <Link className="mt-4 inline-block text-sm font-bold underline" href={"/desk/automations?activityCursor=" + encodeURIComponent(next) + "#assistant-activity"}>
        Older assistant actions
      </Link> : null}
    </section>
  );
}
