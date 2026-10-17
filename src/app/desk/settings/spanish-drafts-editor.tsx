"use client";

import { translationDraftLimit } from "@/domains/language/draft-limits";
import { useActionState } from "react";
import { saveSpanishDraftAction, type SpanishDraftState } from "./spanish-drafts-action";
import type { TranslationSource } from "@/domains/language/drafts";

function DraftEditor({ source }: { source: TranslationSource }) {
  const [result, action, pending] = useActionState<SpanishDraftState, FormData>(
    saveSpanishDraftAction, { status: "idle", message: "" },
  );
  return (
    <form action={action} className="space-y-2 border-b border-line py-4">
      <input type="hidden" name="kind" value={source.kind} />
      <input type="hidden" name="key" value={source.key} />
      <input type="hidden" name="digest" value={source.digest} />
      <input type="hidden" name="revision" value={source.revision ?? ""} />
      <p className="text-xs font-semibold">{source.kind}: {source.key}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Current English (read-only)
          <textarea readOnly rows={3} value={source.english}
            className="mt-1 w-full rounded border border-line bg-subtle p-2" />
        </label>
        <label className="text-sm">Spanish draft (not published)
          <textarea name="spanish" rows={3} maxLength={translationDraftLimit(source.kind)}
            key={source.revision ?? "new"} defaultValue={source.spanish ?? ""}
            className="mt-1 w-full rounded border border-line bg-surface p-2" />
        </label>
      </div>
      {source.stale && <p role="alert" className="text-sm font-semibold text-danger">
        English changed after this Spanish draft; revise before review.
      </p>}
      <button type="submit" disabled={pending}
        className="rounded border border-line px-3 py-2 text-sm disabled:opacity-60">
        {pending ? "Saving…" : "Save Spanish draft"}
      </button>
      <p role="status" aria-live="polite" className="text-xs">{result.message}</p>
    </form>
  );
}

export function SpanishDraftsEditor({ sources }: { sources: TranslationSource[] }) {
  const site = sources.filter(x => x.kind === "SITE");
  const legal = sources.filter(x => x.kind === "LEGAL");
  const messages = sources.filter(x => x.kind === "COMMUNICATION" || x.kind === "MESSAGE" || x.kind === "NOTICE" || x.kind === "QUOTE");
  return (
    <div className="space-y-2 text-sm">
      <p>Spanish copies are privately drafted alongside the current English source.
        Editing does not publish the website, change communication consent, or authorize
        translations in an active customer document.</p>
      <p>{sources.filter(x => x.spanish && !x.stale).length} current drafts of {sources.length} English sources.
        Actual fluent review and legal confirmation are separate owner actions.</p>
      <details>
        <summary className="cursor-pointer font-semibold">Website wording ({site.length} fields)</summary>
        {site.map(source => <DraftEditor key={source.kind+source.key} source={source}/>)}
      </details>
      <details>
        <summary className="cursor-pointer font-semibold">Informational legal translations ({legal.length}) — English controls</summary>
        {legal.map(source => <DraftEditor key={source.kind+source.key} source={source}/>)}
      </details>
      <details>
        <summary className="cursor-pointer font-semibold">Communication templates ({messages.length})</summary>
        {messages.map(source => <DraftEditor key={source.kind+source.key} source={source}/>)}
      </details>
    </div>
  );
}
