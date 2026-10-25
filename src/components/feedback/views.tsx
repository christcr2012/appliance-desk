import Link from "next/link";
import { StatusPill } from "@/components/ui";
import { businessDateKey, formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import type { MyFeedbackDetail, MyFeedbackRow, Page } from "@/domains/feedback";
import { isFinalState, kindWords, reporterPill } from "@/domains/feedback/rules";
import { ReporterActions } from "./reporter-actions";

// MCP-10a: the sender's own screens ("My reports" and one report), shared by the desk and the customer portal.

export function relativeBusinessDay(date: Date, now = new Date()): string {
  const day = businessDateKey(date);
  const today = businessDateKey(now);
  if (day === today) return "today";
  const yesterday = businessDateKey(new Date(now.getTime() - 86_400_000));
  if (day === yesterday) return "yesterday";
  return formatBusinessDate(date);
}

export function RepairsPointer({ area }: { area: "desk" | "account" }) {
  return (
    <p className="text-sm text-ink">
      This is for problems with this website or app.{" "}
      <strong>Appliance not working?</strong>{" "}
      {area === "account" ? (
        <Link className="font-semibold underline" href="/account/maintenance?request=repair">Request a repair</Link>
      ) : (
        <Link className="font-semibold underline" href="/desk/maintenance">Open repairs</Link>
      )}
    </p>
  );
}

export function MyReportsList({ page, base, newHref, moreHref }: {
  page: Page<MyFeedbackRow>; base: string; newHref: string; moreHref: string | null;
}) {
  if (page.rows.length === 0) {
    return (
      <div className="rounded-card bg-subtle p-5 text-sm">
        <p className="font-medium text-ink">You haven&apos;t sent any app feedback.</p>
        <Link href={newHref} className="mt-3 inline-flex min-h-11 items-center font-semibold underline">App feedback</Link>
      </div>
    );
  }
  // "We have a question" first (stable within the shown window), then newest first.
  const rows = [...page.rows].sort((a, b) => Number(b.state === "NEEDS_INFORMATION") - Number(a.state === "NEEDS_INFORMATION"));
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {rows.map((row) => {
          const pill = reporterPill(row.state);
          const question = row.state === "NEEDS_INFORMATION";
          return (
            <li key={row.id}>
              <Link
                href={`${base}/${encodeURIComponent(row.id)}`}
                className="flex min-h-16 flex-col gap-2 rounded-card border border-line bg-surface p-4 hover:bg-subtle sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex min-w-0 items-center gap-2 font-semibold text-ink">
                  {question && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-danger" />}
                  <span className="min-w-0 break-words">#{row.number} · {row.title}</span>
                </span>
                <span className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
                  <StatusPill tone={pill.tone} label={pill.label} />
                  <span>Updated {relativeBusinessDay(row.updatedAt)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {moreHref && <Link href={moreHref} className="inline-flex min-h-11 items-center font-semibold underline">Load more</Link>}
      {page.atCap && <p className="text-sm text-ink-soft">Narrow your filters to see more</p>}
    </div>
  );
}

export function MyReportView({ report, attachmentBase, reopenDays }: {
  report: MyFeedbackDetail; attachmentBase: string; reopenDays: number;
}) {
  const pill = reporterPill(report.state);
  const final = isFinalState(report.state);
  const mode = report.state === "NEEDS_INFORMATION" ? "question" : !final ? "open" : report.canReopen ? "reopen" : "none";
  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <p className="text-sm text-ink-soft">Report #{report.number} · {kindWords(report.kind)}</p>
        <h1 className="break-words text-2xl font-semibold text-ink">{report.title}</h1>
        <StatusPill tone={pill.tone} label={pill.label} />
      </header>

      <section aria-label="Conversation" className="space-y-3">
        <article className="rounded-card border border-line bg-surface p-4">
          <p className="text-sm font-semibold text-ink">You · {formatBusinessDate(report.createdAt)}</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-ink">{report.description}</p>
          {report.expected && (
            <p className="mt-3 whitespace-pre-wrap break-words text-sm text-ink"><strong>What you expected:</strong> {report.expected}</p>
          )}
          {report.steps && (
            <p className="mt-3 whitespace-pre-wrap break-words text-sm text-ink"><strong>Steps:</strong> {report.steps}</p>
          )}
        </article>
        {report.entries.map((entry) => (
          <article key={entry.id} className={`rounded-card border p-4 ${entry.mine ? "border-line bg-surface" : "border-line bg-subtle"}`}>
            <p className="text-sm font-semibold text-ink">{entry.who} · {formatBusinessDate(entry.at)}, {formatBusinessTime(entry.at)}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-ink">{entry.body}</p>
          </article>
        ))}
      </section>

      {report.attachments.length > 0 && (
        <section aria-label="Screenshots" className="space-y-2">
          <h2 className="text-lg font-semibold text-ink">Screenshots</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {report.attachments.map((picture, index) => (
              <li key={picture.id}>
                <a href={`${attachmentBase}/${encodeURIComponent(picture.id)}`} target="_blank" rel="noopener" className="block">
                  {/* Private picture served by this app's own read route; next/image can't fetch it with the person's sign-in. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${attachmentBase}/${encodeURIComponent(picture.id)}`}
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

      <ReporterActions
        id={report.id}
        version={report.version}
        mode={mode}
        canAddPictures={report.canAddPictures}
        picturesLeft={report.picturesLeft}
        reopenDays={reopenDays}
      />
    </div>
  );
}
