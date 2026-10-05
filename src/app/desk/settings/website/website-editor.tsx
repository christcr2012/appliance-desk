"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  publishWebsiteDraftAction,
  restoreWebsiteVersionAction,
  saveWebsiteDraftAction,
} from "./actions";

type Field = {
  key: string;
  label: string;
  help: string;
  kind: "short" | "paragraph" | "url" | "alt" | "meta";
  page: string;
  section: string;
  ownerInput?: string;
  default: string;
};

type HistoryRow = { id: string; version: number; live: boolean; when: string; by: string | null; note: string | null };

const MAX: Record<Field["kind"], number> = { short: 120, paragraph: 2000, url: 500, alt: 160, meta: 160 };

const PREVIEW_PATH: Record<string, string> = {
  "Home page": "/",
  "Price cards": "/pricing",
  "How it works": "/how-it-works",
  "Get a quote": "/contact",
  Pricing: "/pricing",
  "Service area": "/service-area",
};

const THUMBS: Record<string, string> = {
  "image.hero.alt": "/appliances/hero-lineup.jpg",
  "image.washer-dryer-set.alt": "/appliances/washer-dryer-set.jpg",
  "image.washer.alt": "/appliances/washer.jpg",
  "image.dryer.alt": "/appliances/dryer.jpg",
};

export function WebsiteEditor({
  fields,
  defaults,
  live,
  start,
  draft,
  history,
}: {
  fields: Field[];
  defaults: Record<string, string>;
  live: Record<string, string>;
  start: Record<string, string>;
  draft: { id: string; version: number } | null;
  history: HistoryRow[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(start);
  const [saved, setSaved] = useState<Record<string, string>>(start);
  const [draftRef, setDraftRef] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const dirty = useMemo(() => fields.some((f) => (values[f.key] ?? "") !== (saved[f.key] ?? "")), [fields, values, saved]);
  const changedFromLive = useMemo(
    () => fields.filter((f) => (saved[f.key] ?? "") !== (live[f.key] ?? "")),
    [fields, saved, live],
  );

  const groups = useMemo(() => {
    const out: { page: string; sections: { section: string; items: Field[] }[] }[] = [];
    for (const f of fields) {
      let page = out.find((p) => p.page === f.page);
      if (!page) out.push((page = { page: f.page, sections: [] }));
      let sec = page.sections.find((s) => s.section === f.section);
      if (!sec) page.sections.push((sec = { section: f.section, items: [] }));
      sec.items.push(f);
    }
    return out;
  }, [fields]);

  async function save() {
    setBusy(true);
    setMessage(null);
    setConfirming(false);
    try {
      // Only what differs from the starting text is stored; an empty box means "use the starting text".
      const changes: Record<string, string> = {};
      for (const f of fields) {
        const v = (values[f.key] ?? "").trim();
        if (v !== (defaults[f.key] ?? "")) changes[f.key] = v;
      }
      const result = await saveWebsiteDraftAction({
        draftId: draftRef?.id,
        expectedVersion: draftRef?.version,
        fields: changes,
      });
      if (result.status === "saved") {
        setDraftRef({ id: result.draftId, version: result.version });
        setSaved(values);
        setMessage({ kind: "success", text: "Draft saved. Visitors still see the old text until you publish." });
      } else if (result.status === "error") {
        setMessage({ kind: "error", text: result.message });
      }
    } catch {
      setMessage({ kind: "error", text: "That could not be saved. Your changes are still on the screen; please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!draftRef) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await publishWebsiteDraftAction(draftRef.id, draftRef.version);
      if (result.status === "done") {
        setConfirming(false);
        setMessage({ kind: "success", text: "Published. The public website now shows your text." });
        router.refresh();
      } else if (result.status === "error") {
        setMessage({ kind: "error", text: result.message });
      }
    } catch {
      setMessage({ kind: "error", text: "That could not be published. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function restore(id: string, version: number) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await restoreWebsiteVersionAction(id);
      if (result.status === "done") {
        setMessage({ kind: "success", text: `Version ${version} is live again (saved as a new version).` });
        router.refresh();
      } else if (result.status === "error") {
        setMessage({ kind: "error", text: result.message });
      }
    } catch {
      setMessage({ kind: "error", text: "That could not be restored. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  const buttonBase = "inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold disabled:opacity-50";
  const primary = `${buttonBase} bg-primary text-white`;
  const secondary = `${buttonBase} border border-gray-400 text-ink`;

  return (
    <div className="mt-6 space-y-8">
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-lg px-4 py-3 text-sm ${message.kind === "success" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}
        >
          {message.text}
        </p>
      )}

      {groups.map((group) => (
        <section key={group.page} aria-labelledby={`page-${group.page}`} className="rounded-xl border border-gray-300 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id={`page-${group.page}`} className="text-lg font-semibold text-ink">
              {group.page}
            </h2>
            {draftRef && PREVIEW_PATH[group.page] && (
              <a
                className="text-sm font-medium text-primary underline"
                href={`${PREVIEW_PATH[group.page]}?revision=${draftRef.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Preview {group.page.toLowerCase()} with my saved draft (opens a new tab)
              </a>
            )}
          </div>
          {group.sections.map((sec) => (
            <fieldset key={sec.section} className="mt-5 space-y-5">
              <legend className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{sec.section}</legend>
              {sec.items.map((f) => {
                const id = `f-${f.key}`;
                const value = values[f.key] ?? "";
                const max = MAX[f.kind];
                const multiline = f.kind === "paragraph";
                return (
                  <div key={f.key}>
                    <label htmlFor={id} className="block text-sm font-medium text-ink">
                      {f.label}
                    </label>
                    {f.ownerInput && (
                      <p className="mt-1 text-xs font-semibold text-amber-900">
                        Needs your decision ({f.ownerInput}) — it stays as it is until you change it.
                      </p>
                    )}
                    <div className={THUMBS[f.key] ? "mt-2 flex items-start gap-3" : "mt-2"}>
                      {THUMBS[f.key] && (
                        // eslint-disable-next-line @next/next/no-img-element -- a small fixed preview of a file in /public
                        <img src={THUMBS[f.key]} alt="" width={96} height={64} className="h-16 w-24 rounded-md object-cover" />
                      )}
                      {multiline ? (
                        <textarea
                          id={id}
                          aria-describedby={`${id}-help`}
                          value={value}
                          maxLength={max}
                          rows={4}
                          onChange={(e) => setValues((c) => ({ ...c, [f.key]: e.target.value }))}
                          className="w-full rounded-lg border border-gray-400 px-3 py-2 text-sm"
                        />
                      ) : (
                        <input
                          id={id}
                          aria-describedby={`${id}-help`}
                          type="text"
                          value={value}
                          maxLength={max}
                          onChange={(e) => setValues((c) => ({ ...c, [f.key]: e.target.value }))}
                          className="min-h-11 w-full rounded-lg border border-gray-400 px-3 text-sm"
                        />
                      )}
                    </div>
                    <p id={`${id}-help`} className="mt-1 text-xs text-ink-soft">
                      {f.help} <span>({value.length} of {max} characters.)</span>
                      {value !== (defaults[f.key] ?? "") && (
                        <>
                          {" "}
                          <button
                            type="button"
                            className="font-medium text-primary underline"
                            onClick={() => setValues((c) => ({ ...c, [f.key]: defaults[f.key] ?? "" }))}
                          >
                            Restore the starting text
                          </button>
                        </>
                      )}
                    </p>
                  </div>
                );
              })}
            </fieldset>
          ))}
        </section>
      ))}

      <div className="sticky bottom-0 z-10 rounded-xl border border-gray-300 bg-surface p-4 shadow">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={primary} disabled={busy || !dirty} onClick={save}>
            Save draft
          </button>
          <button
            type="button"
            className={secondary}
            disabled={busy || dirty || !draftRef || changedFromLive.length === 0}
            onClick={() => setConfirming(true)}
          >
            Publish…
          </button>
          <span className="text-sm text-ink-soft">
            {dirty
              ? "You have changes that are not saved yet. Save the draft first."
              : !draftRef
                ? "No draft yet."
                : changedFromLive.length === 0
                  ? "Your draft matches what is live."
                  : `${changedFromLive.length} change${changedFromLive.length === 1 ? "" : "s"} waiting to be published.`}
          </span>
        </div>
        {confirming && (
          <div role="group" aria-label="Confirm publishing" className="mt-4 rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-ink">
            <p className="font-semibold">Publish these changes to the public website?</p>
            <ul className="mt-2 list-disc pl-5">
              {changedFromLive.map((f) => (
                <li key={f.key}>
                  {f.page} — {f.section}: {f.label}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-3">
              <button type="button" className={primary} disabled={busy} onClick={publish}>
                Publish now
              </button>
              <button type="button" className={secondary} disabled={busy} onClick={() => setConfirming(false)}>
                Not yet
              </button>
            </div>
          </div>
        )}
      </div>

      <section aria-labelledby="history-heading" className="rounded-xl border border-gray-300 p-5">
        <h2 id="history-heading" className="text-lg font-semibold text-ink">
          History
        </h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">Nothing has been published yet, so the website shows its original text.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-200">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <span>
                  <strong>Version {h.version}</strong>
                  {h.live ? " — live now" : ""} · {h.when}
                  {h.by ? ` · by ${h.by}` : ""}
                  {h.note ? ` · ${h.note}` : ""}
                </span>
                {!h.live && (
                  <button type="button" className={secondary} disabled={busy} onClick={() => restore(h.id, h.version)}>
                    Restore this version
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
