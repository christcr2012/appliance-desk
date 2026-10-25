import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getFeedbackForTriage } from "@/domains/feedback";
import { kindWords, teamPill, TEAM_STATE_WORDS } from "@/domains/feedback/rules";
import { describeRouteTemplate, describeSafeContext } from "@/domains/feedback/context";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { StatusPill } from "@/components/ui";
import { orNotFound } from "@/components/feedback/page-helpers";
import { TriageActions } from "@/components/feedback/triage-actions";

export const metadata = { title: "App feedback report" };

const ROLE_WORDS: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", STAFF: "Staff", CUSTOMER: "Customer" };
const EVENT_WORDS: Record<string, string> = {
  SUBMITTED: "Sent the report", STATE_CHANGED: "Changed the status", REPLIED: "Replied", NOTE_ADDED: "Added a note",
  DETAILS_ADDED: "Added details", MARKED_DUPLICATE: "Marked as already reported", REOPENED: "Reopened it",
  CLOSED_BY_REPORTER: "Closed it", CONTENT_REMOVED: "Content removed at the person's request", ATTACHMENT_ADDED: "Added a picture",
};

function when(date: Date) {
  return `${formatBusinessDate(date)}, ${formatBusinessTime(date)}`;
}

// MCP-10a: the owner/admin view of one report: everything, plus internal notes and the history.
export default async function FeedbackTriageReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const report = await orNotFound(() => getFeedbackForTriage(id));
  const pill = teamPill(report.state, report.awaitingTeam);
  const live = report.attachments.filter((picture) => !picture.deleted);
  return (
    <div className="max-w-4xl space-y-5">
      <Link href="/desk/feedback" className="inline-flex min-h-11 items-center text-sm font-semibold underline">App feedback</Link>
      <header className="space-y-2">
        <p className="text-sm text-ink-soft">Report #{report.number} · {kindWords(report.kind)}</p>
        <h1 className="break-words text-2xl font-semibold text-ink">{report.title}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
          <StatusPill tone={pill.tone} label={pill.label} />
          <span>From {report.reporter.name} ({ROLE_WORDS[report.reporter.role]})</span>
          {report.reporterOtherReports > 0 && (
            <Link className="font-semibold underline" href={`/desk/feedback?tab=open&reporter=${encodeURIComponent(report.reporter.id)}`}>
              {report.reporterOtherReports} other {report.reporterOtherReports === 1 ? "report" : "reports"} from them
            </Link>
          )}
          {report.duplicateOf && (
            <Link className="font-semibold underline" href={`/desk/feedback/${encodeURIComponent(report.duplicateOf.id)}`}>
              Same as report #{report.duplicateOf.number}
            </Link>
          )}
        </div>
      </header>

      <section aria-label="What they sent" className="space-y-3 rounded-card border border-line bg-surface p-4">
        <p className="text-sm font-semibold text-ink">{report.reporter.name} · {when(report.createdAt)}</p>
        <p className="whitespace-pre-wrap break-words text-ink">{report.description}</p>
        {report.expected && <p className="whitespace-pre-wrap break-words text-sm text-ink"><strong>What they expected:</strong> {report.expected}</p>}
        {report.steps && <p className="whitespace-pre-wrap break-words text-sm text-ink"><strong>Steps:</strong> {report.steps}</p>}
        <p className="text-sm text-ink-soft">
          Page: {describeRouteTemplate(report.routeTemplate)}
          {report.appRevision ? ` · App version ${report.appRevision}` : ""} · {describeSafeContext(report.safeContext)}
        </p>
      </section>

      {live.length > 0 && (
        <section aria-label="Screenshots" className="space-y-2">
          <h2 className="text-lg font-semibold text-ink">Screenshots</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {live.map((picture, index) => (
              <li key={picture.id}>
                <a href={`/api/feedback-attachments/${encodeURIComponent(picture.id)}`} target="_blank" rel="noopener" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/feedback-attachments/${encodeURIComponent(picture.id)}`}
                    alt={`Screenshot ${index + 1}`}
                    width={picture.width}
                    height={picture.height}
                    loading="lazy"
                    className="h-auto w-full rounded-control border border-line"
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Conversation" className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Conversation</h2>
        {report.entries.length === 0 && <p className="text-sm text-ink-soft">No replies yet.</p>}
        {report.entries.map((entry) => (
          <article
            key={entry.id}
            className={`rounded-card border p-4 ${entry.visibility === "INTERNAL" ? "border-line bg-warning-bg text-warning-ink" : "border-line bg-surface"}`}
          >
            <p className="text-sm font-semibold">
              {entry.who} · {when(entry.at)}
              {entry.visibility === "INTERNAL" && " · Only your team sees this"}
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words">{entry.body}</p>
          </article>
        ))}
      </section>

      <TriageActions
        id={report.id}
        version={report.version}
        allowedStates={report.allowedStates}
        canMarkDuplicate={report.canMarkDuplicate}
        locked={report.contentRemoved}
      />

      <section aria-label="History" className="space-y-2">
        <h2 className="text-lg font-semibold text-ink">History</h2>
        <ol className="space-y-2 text-sm text-ink">
          {report.events.map((event) => (
            <li key={event.id} className="rounded-control border border-line bg-surface px-3 py-2">
              <span className="font-semibold">{EVENT_WORDS[event.action] ?? "Changed"}</span>
              {event.toState && event.action !== "SUBMITTED" ? ` → ${TEAM_STATE_WORDS[event.toState]}` : ""} · {event.who} · {when(event.at)}
              {event.reason && <span className="block text-ink-soft">Reason: {event.reason}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
