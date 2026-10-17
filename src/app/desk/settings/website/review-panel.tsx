"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import type { FactUse, PageEffect, ReviewChange } from "@/domains/site-content/review";
import { changeKindName } from "@/domains/site-content/review";
import { publishWebsiteAction } from "./actions";
import { ValueView } from "./value-view";

export type ReviewData = {
  draft: { id: string; version: number } | null;
  liveRevisionId: string | null;
  changes: ReviewChange[];
  pages: PageEffect[];
  facts: FactUse[];
  problems: string[];
};

/** Everything that will change, in plain words, with the publish button. Publishing is refused if anything moved. */
export function ReviewPanel({ review, nowIso, pagePaths }: { review: ReviewData; nowIso: string; pagePaths: Record<string, string | null> }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ version: number; alreadyLive: boolean } | null>(null);
  const [error, setError] = useState<{ text: string; stale: boolean } | null>(null);
  const lock = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);

  async function publish() {
    if (lock.current || !review.draft) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await publishWebsiteAction({ draftId: review.draft.id, version: review.draft.version, liveRevisionId: review.liveRevisionId });
      if (result.status === "published") setDone({ version: result.version, alreadyLive: result.alreadyLive });
      else {
        setError({ text: result.status === "error" ? result.message : "That could not be published.", stale: result.status === "error" && result.stale === true });
        setTimeout(() => alertRef.current?.focus(), 0);
      }
    } catch {
      setError({ text: "That could not be published, and nothing changed on the live website. Please try again.", stale: false });
      setTimeout(() => alertRef.current?.focus(), 0);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  if (done) {
    const live = review.pages.filter((p) => p.pageId && pagePaths[p.pageId]);
    return (
      <Card title={done.alreadyLive ? "Already live" : "Published"}>
        <p role="status" className="text-sm text-ink">
          {done.alreadyLive ? "This draft was already published, so nothing more changed." : `Your changes are now live as version ${done.version}.`}
        </p>
        {live.length > 0 && (
          <>
            <p className="mt-4 text-sm font-semibold text-ink">Look at the live pages</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {live.map((p) => <li key={p.pageId}><a className="underline" href={pagePaths[p.pageId!]!} target="_blank" rel="noopener noreferrer">{p.pageName} (opens in a new tab)</a></li>)}
            </ul>
          </>
        )}
        <p className="mt-4"><Link className="underline" href="/desk/settings/website">Back to the Website overview</Link></p>
      </Card>
    );
  }

  if (!review.draft || review.changes.length === 0) {
    return (
      <Card title="Nothing to publish">
        <p className="text-sm text-ink-soft">{review.draft ? "Your draft is the same as the live website." : "You have no draft. Make a change first, and save it as a draft."}</p>
        <p className="mt-3"><Link className="underline" href="/desk/settings/website?view=edit">Edit a page</Link></p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div ref={alertRef} tabIndex={-1} className="outline-none">
        {error && (
          <p role="alert" className="rounded-control border border-danger p-3 text-sm font-semibold text-danger">
            {error.text}{error.stale && <> <Button variant="secondary" className="ml-2" onClick={() => window.location.reload()}>Reload and review again</Button></>}
          </p>
        )}
      </div>

      {review.problems.length > 0 && (
        <Card title="Fix these before publishing">
          <ul className="list-disc space-y-1 pl-5 text-sm text-danger">
            {review.problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <p className="mt-3"><Link className="underline" href="/desk/settings/website?view=edit">Go back and fix it</Link></p>
        </Card>
      )}

      <Card title={`${review.changes.length} ${review.changes.length === 1 ? "change" : "changes"} to review`} description="Compare what visitors see now with what they will see once you publish.">
        <ol className="divide-y divide-line">
          {review.changes.map((change) => (
            <li key={change.key} className="py-4">
              <h3 className="text-base font-semibold text-ink">{change.label} <span className="text-sm font-normal text-ink-soft">· {change.pageName} · {changeKindName(change)}</span></h3>
              <p className="mt-1 text-xs text-ink-soft">Appears on: {change.where}.</p>
              <dl className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="min-w-0 rounded-control bg-subtle p-3 text-sm"><dt className="font-semibold text-ink">Live now</dt><dd className="mt-1 text-ink"><ValueView summary={change.before} nowIso={nowIso} /></dd></div>
                <div className="min-w-0 rounded-control border border-line p-3 text-sm"><dt className="font-semibold text-ink">After you publish</dt><dd className="mt-1 text-ink"><ValueView summary={change.after} nowIso={nowIso} /></dd></div>
              </dl>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Pages affected">
          <ul className="space-y-1 text-sm">{review.pages.map((p) => <li key={p.pageName}>{p.pageName}: {p.count} {p.count === 1 ? "change" : "changes"}</li>)}</ul>
        </Card>
        <Card title="Details filled in for you" description="These come from your Settings and always show the current value.">
          {review.facts.length === 0 ? <p className="text-sm text-ink-soft">None of the changed words use your business details.</p> : (
            <ul className="space-y-1 text-sm">{review.facts.map((f) => <li key={f.placeholder}>{f.label}: {f.value ? <strong>{f.value}</strong> : <span className="text-ink-soft">filled in on each page</span>}</li>)}</ul>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" disabled={busy || review.problems.length > 0} onClick={() => void publish()}>{busy ? "Publishing…" : `Publish ${review.changes.length} ${review.changes.length === 1 ? "change" : "changes"} to the live website`}</Button>
        <Link className="underline" href="/desk/settings/website?view=edit">Keep editing</Link>
      </div>
      <p className="text-xs text-ink-soft">Publishing is checked against the live website you reviewed. If someone else changes it first, nothing is published and you will be asked to review again.</p>
    </div>
  );
}
