import Link from "next/link";
import { Button, Card, StatusPill } from "@/components/ui";
import type { StatusTone } from "@/components/status-badge";
import type { SystemIssueDTO } from "@/domains/system-issues/queries";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { addSystemIssueNoteAction, markSystemIssueResolvedAction } from "./actions";

function occurred(at: Date): string {
  return `${formatBusinessDate(at)} at ${formatBusinessTime(at)}`;
}
function statusTone(issue: SystemIssueDTO): StatusTone {
  return issue.status === "RESOLVED" ? "success"
    : issue.severity === "HIGH" ? "attention" : "pending";
}

export function SystemIssuesSection({ issues, nextCursor, canManage }: {
  issues: SystemIssueDTO[]; nextCursor: string | null; canManage: boolean;
}) {
  return (
    <section id="system-issues" aria-labelledby="system-issues-heading" className="mb-8 space-y-4 scroll-mt-4">
      <div>
        <h2 id="system-issues-heading" className="text-xl font-semibold text-ink">Problems the system found</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Diagnostic signals, not customer tasks. Unknown results need checking before any retry.
        </p>
      </div>
      {issues.length === 0 && (
        <Card title="No recorded system problems" description="No issues match this page. This does not guarantee every outside provider is available.">
          <p className="text-sm text-ink-soft">Scheduled task health appears below.</p>
        </Card>
      )}
      {issues.map((issue) => (
        <div key={issue.id} data-testid={`system-issue-${issue.id}`}>
        <Card key={issue.id} title={issue.summary}
          description={issue.detail}
          actions={<StatusPill tone={statusTone(issue)} label={`${issue.severity} · ${issue.status}`} />}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-ink-soft">First recorded</dt><dd>{occurred(issue.firstSeenAt)}</dd></div>
            <div><dt className="text-ink-soft">Last verified signal</dt><dd>{occurred(issue.lastSeenAt)}</dd></div>
            <div><dt className="text-ink-soft">Occurrences</dt><dd>{issue.occurrences}</dd></div>
            <div><dt className="text-ink-soft">Review state</dt><dd>{issue.status}</dd></div>
          </dl>
          <div className="mt-4 rounded-control border border-line bg-subtle p-3">
            <p className="text-sm text-ink">{issue.recovery.instruction}</p>
            <Link className="mt-2 inline-block text-sm font-semibold underline" href={issue.recovery.href}>
              Review source or recovery instructions
            </Link>
          </div>
          {issue.notes.length > 0 && (
            <div className="mt-4 space-y-2">
              <h3 className="text-sm font-semibold text-ink">Private owner notes</h3>
              {issue.notes.map((note, index) => (
                <p key={index} className="rounded-control bg-subtle p-3 text-sm text-ink">
                  <span className="text-ink-soft">{occurred(note.createdAt)}: </span>{note.body}
                </p>
              ))}
            </div>
          )}
          {canManage && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <form action={addSystemIssueNoteAction} className="space-y-2">
                <input type="hidden" name="issueId" value={issue.id} />
                <input type="hidden" name="version" value={issue.version} />
                <label htmlFor={`note-${issue.id}`} className="block text-sm font-medium text-ink">
                  Add private note (no customer information)
                </label>
                <textarea id={`note-${issue.id}`} name="body" required maxLength={1800}
                  rows={2} className="w-full rounded-control border border-line bg-surface p-2 text-sm text-ink" />
                <Button type="submit" variant="secondary">Save note</Button>
              </form>
              {issue.status !== "RESOLVED" && (
                <form action={markSystemIssueResolvedAction} className="space-y-2">
                  <input type="hidden" name="issueId" value={issue.id} />
                  <input type="hidden" name="version" value={issue.version} />
                  <label htmlFor={`resolve-${issue.id}`} className="block text-sm font-medium text-ink">
                    Resolution reason (no customer information)
                  </label>
                  <textarea id={`resolve-${issue.id}`} name="reason" required maxLength={1800}
                    rows={2} className="w-full rounded-control border border-line bg-surface p-2 text-sm text-ink" />
                  <Button type="submit" variant="secondary">Mark resolved</Button>
                </form>
              )}
            </div>
          )}
        </Card>
        </div>
      ))}
      {nextCursor && (
        <Link href={`/desk/automations?issuesCursor=${encodeURIComponent(nextCursor)}#system-issues`}
          className="inline-block rounded-control border border-line p-2 text-sm font-semibold">
          More system issues
        </Link>
      )}
    </section>
  );
}
