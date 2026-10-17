"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button, Card, StatusPill } from "@/components/ui";
import { discardDraftAction, restoreToDraftAction } from "./actions";

export type HistoryRow = { id: string; version: number; live: boolean; when: string; by: string | null; note: string | null };

/** Every published version, with "Put in draft" (never straight to live) and a way to throw the open draft away. */
export function HistoryPanel({ rows, draft }: { rows: HistoryRow[]; draft: { id: string; version: number; changes: number } | null }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; stale?: boolean } | null>(null);
  const [current, setCurrent] = useState(draft);
  const lock = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);

  async function run(action: () => Promise<Awaited<ReturnType<typeof discardDraftAction>>>, after: (r: Awaited<ReturnType<typeof discardDraftAction>>) => void) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (result.status === "error") { setMessage({ kind: "error", text: result.message, stale: result.stale }); setTimeout(() => alertRef.current?.focus(), 0); }
      else after(result);
    } catch {
      setMessage({ kind: "error", text: "That did not work and nothing changed. Please try again." });
      setTimeout(() => alertRef.current?.focus(), 0);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function restore(row: HistoryRow) {
    if (current && !window.confirm(`This replaces your unpublished draft (${current.changes} ${current.changes === 1 ? "change" : "changes"}) with version ${row.version}. Continue?`)) return;
    void run(() => restoreToDraftAction({ revisionId: row.id, draftId: current?.id, draftVersion: current?.version }), (r) => {
      if (r.status === "restored") {
        setCurrent({ id: r.draftId, version: r.version, changes: 0 });
        setMessage({ kind: "ok", text: `Version ${row.version} is now in your draft. It is not live. Review it, then publish.` });
      }
    });
  }

  return (
    <div className="space-y-6">
      <div ref={alertRef} tabIndex={-1} className="outline-none" aria-live="polite">
        {message && (
          <p role={message.kind === "error" ? "alert" : "status"} className={`rounded-control border p-3 text-sm ${message.kind === "error" ? "border-danger font-semibold text-danger" : "border-line text-ink"}`}>
            {message.text}
            {message.kind === "ok" && <> <Link className="underline" href="/desk/settings/website?view=review">Review the draft</Link></>}
            {message.stale && <> <Button variant="secondary" className="ml-2" onClick={() => window.location.reload()}>Reload the latest</Button></>}
          </p>
        )}
      </div>

      {current && (
        <Card title="Your unpublished draft" description="Visitors do not see it. Throwing it away does not change the live website.">
          <Button variant="danger" disabled={busy} onClick={() => {
            if (!window.confirm("Throw away your unpublished draft? The live website is not affected.")) return;
            void run(() => discardDraftAction({ draftId: current.id, version: current.version }), () => { setCurrent(null); setMessage({ kind: "ok", text: "The draft was discarded. The live website did not change." }); });
          }}>Discard the draft</Button>
        </Card>
      )}

      <Card title="Published versions" description="Newest first. “Put in draft” copies a version into your draft so you can look at it before it goes live.">
        {rows.length === 0 ? <p className="text-sm text-ink-soft">Nothing has been published yet.</p> : (
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-ink">Version {row.version} {row.live && <StatusPill tone="success" label="Live now" />}</p>
                  <p className="text-ink-soft">{row.when}{row.by ? ` · ${row.by}` : ""}</p>
                  {row.note && <p className="break-words text-ink-soft">{row.note}</p>}
                </div>
                {!row.live && <Button variant="secondary" disabled={busy} onClick={() => restore(row)}>Put in draft</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
