"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Field } from "@/components/ui";
import type { EditorField } from "@/domains/site-content/editor-fields";
import { diffValues, sameValue } from "@/domains/site-content/review";
import type { SiteValue } from "@/domains/site-content/types";
import { saveWebsiteValuesAction } from "./actions";
import { FieldEditor, type AssetInfo } from "./field-editor";

export type WorkspacePage = { id: string; name: string; about: string; previewPath: string | null; beforeOpeningOnly: boolean; note: string | null };

type Props = {
  pages: WorkspacePage[];
  fields: EditorField[];
  defaults: Record<string, SiteValue>;
  liveStored: Record<string, SiteValue>;
  startValues: Record<string, SiteValue>;
  draft: { id: string; version: number } | null;
  liveRevisionId: string | null;
  assets: AssetInfo[];
  facts: Record<string, string>;
  nowIso: string;
  initialPageId?: string;
  initialKey?: string;
  /** Show only these pages (the "Photos" and "Contact & prices" shortcuts). */
  onlyPageIds?: string[];
  onlyKinds?: string[];
};

type Step = "pages" | "items" | "edit";

const serialize = (values: Record<string, SiteValue>) => JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));

export function WebsiteWorkspace(props: Props) {
  const router = useRouter();
  const { fields, defaults, liveStored } = props;
  const visibleFields = useMemo(
    () => fields.filter((f) => (!props.onlyPageIds || props.onlyPageIds.includes(f.pageId)) && (!props.onlyKinds || props.onlyKinds.includes(f.valueKind))),
    [fields, props.onlyPageIds, props.onlyKinds],
  );
  const pages = useMemo(() => props.pages.filter((p) => visibleFields.some((f) => f.pageId === p.id)), [props.pages, visibleFields]);

  const [values, setValues] = useState<Record<string, SiteValue>>(props.startValues);
  const [baseline, setBaseline] = useState(() => serialize(props.startValues));
  const [draft, setDraft] = useState(props.draft);
  const [assets, setAssets] = useState(props.assets);
  const initialField = visibleFields.find((f) => f.key === props.initialKey);
  const [pageId, setPageId] = useState(initialField?.pageId ?? props.initialPageId ?? pages[0]?.id ?? "home");
  const [key, setKey] = useState<string | null>(initialField?.key ?? null);
  const [step, setStep] = useState<Step>(initialField ? "edit" : props.initialPageId ? "items" : "pages");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; stale?: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);
  const savingRef = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const dirty = serialize(values) !== baseline;
  const liveEffective = useMemo(() => ({ ...defaults, ...liveStored }), [defaults, liveStored]);
  const draftEffective = useMemo(() => ({ ...defaults, ...values }), [defaults, values]);
  const changeCount = useMemo(() => diffValues(liveEffective, draftEffective).length, [liveEffective, draftEffective]);
  const changedKeys = useMemo(() => new Set(diffValues(liveEffective, draftEffective).map((c) => c.key)), [liveEffective, draftEffective]);

  const page = pages.find((p) => p.id === pageId) ?? pages[0];
  const pageFields = visibleFields.filter((f) => f.pageId === page?.id);
  const sections = useMemo(() => {
    const out: { section: string; fields: EditorField[] }[] = [];
    for (const f of pageFields) {
      let g = out.find((s) => s.section === f.section);
      if (!g) out.push((g = { section: f.section, fields: [] }));
      g.fields.push(f);
    }
    return out;
  }, [pageFields]);
  const field = visibleFields.find((f) => f.key === key) ?? null;

  const needle = query.trim().toLowerCase();
  const results = needle
    ? visibleFields.filter((f) => `${f.label} ${f.help} ${f.section} ${f.pageName} ${f.where}`.toLowerCase().includes(needle)).slice(0, 25)
    : [];

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const choose = useCallback((target: EditorField) => {
    setPageId(target.pageId);
    setKey(target.key);
    setStep("edit");
    setMode("edit");
    setTimeout(() => editorRef.current?.focus(), 0);
  }, []);

  const previewRevision = draft?.id ?? props.liveRevisionId;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; key?: unknown; revision?: unknown } | null;
      if (!data || data.type !== "website-select" || typeof data.key !== "string" || data.revision !== previewRevision) return;
      const target = visibleFields.find((f) => f.key === data.key);
      if (target) choose(target);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [choose, previewRevision, visibleFields]);

  function setValue(next: SiteValue | undefined) {
    if (!field) return;
    setMessage(null);
    setValues((prev) => {
      const copy = { ...prev };
      if (next === undefined || sameValue(next, defaults[field.key])) delete copy[field.key];
      else copy[field.key] = next;
      return copy;
    });
  }

  async function save(): Promise<boolean> {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveWebsiteValuesAction({ draftId: draft?.id, expectedVersion: draft?.version, values });
      if (result.status === "saved") {
        setDraft({ id: result.draftId, version: result.version });
        setBaseline(serialize(values));
        setNonce((n) => n + 1);
        setMessage({ kind: "ok", text: "Draft saved. Visitors still see the live website." });
        return true;
      }
      setMessage({ kind: "error", text: result.status === "error" ? result.message : "That could not be saved.", stale: result.status === "error" ? result.stale : undefined });
      setTimeout(() => alertRef.current?.focus(), 0);
      return false;
    } catch {
      setMessage({ kind: "error", text: "That could not be saved. Everything you typed is still here; please try again." });
      setTimeout(() => alertRef.current?.focus(), 0);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function review() {
    if (dirty && !(await save())) return;
    router.push("/desk/settings/website?view=review");
  }

  function leave(event: React.MouseEvent) {
    if (dirty && !window.confirm("You have changes that are not saved. Leave without saving them?")) event.preventDefault();
  }

  const previewSrc = page?.previewPath && previewRevision
    ? `/website-preview?path=${encodeURIComponent(page.previewPath)}&revision=${encodeURIComponent(previewRevision)}&n=${nonce}`
    : null;

  const status = saving ? "Saving…" : dirty ? "You have changes that are not saved." : draft ? `Draft saved (${changeCount} ${changeCount === 1 ? "change" : "changes"} from the live website).` : "No draft yet. Nothing to publish.";

  return (
    <div>
      <div ref={alertRef} tabIndex={-1} aria-live="polite" className="outline-none">
        {message && (
          <p role={message.kind === "error" ? "alert" : "status"} className={`mb-4 rounded-control border p-3 text-sm ${message.kind === "error" ? "border-danger font-semibold text-danger" : "border-line text-ink"}`}>
            {message.text}
            {message.stale && <> <Button variant="secondary" className="ml-2" onClick={() => window.location.reload()}>Reload the latest</Button></>}
          </p>
        )}
      </div>

      <div className="mb-4">
        <Field id="website-search" type="search" label="Search for words, a button or a picture" help="For example: phone, delivery, banner" value={query} onChange={(e) => setQuery(e.target.value)} />
        {needle && (
          <ul aria-label="Search results" className="mt-2 divide-y divide-line rounded-control border border-line">
            {results.length === 0 && <li className="p-3 text-sm text-ink-soft">Nothing matches “{query}”.</li>}
            {results.map((f) => (
              <li key={f.key}>
                <button type="button" className="min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-subtle" onClick={() => { choose(f); setQuery(""); }}>
                  <span className="font-semibold text-ink">{f.label}</span> <span className="text-ink-soft">· {f.pageName} · {f.section}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[16rem_minmax(0,1fr)_minmax(0,1fr)]">
        <nav aria-label="Website pages and sections" className={`${step === "edit" ? "hidden xl:block" : ""} min-w-0 space-y-4`}>
          <div className={step === "items" ? "hidden xl:block" : ""}>
            <h2 className="text-sm font-semibold text-ink">1. Choose a page</h2>
            <ul className="mt-2 space-y-1">
              {pages.map((p) => {
                const count = visibleFields.filter((f) => f.pageId === p.id && changedKeys.has(f.key)).length;
                return (
                  <li key={p.id}>
                    <button type="button" aria-current={p.id === page?.id ? "page" : undefined} className={`min-h-11 w-full rounded-control px-3 py-2 text-left text-sm ${p.id === page?.id ? "bg-subtle font-semibold" : "hover:bg-subtle"}`} onClick={() => { setPageId(p.id); setKey(null); setStep("items"); }}>
                      {p.name}{count > 0 && <span className="ml-2 text-xs text-ink-soft">({count} changed)</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {page && (
            <div className={step === "pages" ? "hidden xl:block" : ""}>
              <button type="button" className="mb-2 min-h-11 text-sm underline xl:hidden" onClick={() => setStep("pages")}>← All pages</button>
              <h2 className="text-sm font-semibold text-ink">2. Choose a section of “{page.name}”</h2>
              <p className="mt-1 text-xs text-ink-soft">{page.about}</p>
              {sections.map((s) => (
                <div key={s.section} className="mt-3">
                  <h3 className="text-sm font-semibold text-ink">{s.section}</h3>
                  <ul className="mt-1 space-y-1">
                    {s.fields.map((f) => (
                      <li key={f.key}>
                        <button type="button" aria-current={f.key === key ? "true" : undefined} className={`min-h-11 w-full rounded-control px-3 py-2 text-left text-sm ${f.key === key ? "bg-subtle font-semibold" : "hover:bg-subtle"}`} onClick={() => choose(f)}>
                          {f.label}{changedKeys.has(f.key) && <span className="ml-2 text-xs text-ink-soft">(changed)</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </nav>

        <div className={`${step === "edit" ? "" : "hidden xl:block"} min-w-0 xl:col-span-2`}>
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="min-w-0 xl:col-span-2 xl:hidden">
              <button type="button" className="min-h-11 text-sm underline" onClick={() => setStep("items")}>← Back to {page?.name ?? "the list"}</button>
              <div role="group" aria-label="Show" className="mt-2 inline-flex rounded-control border border-control">
                <button type="button" aria-pressed={mode === "edit"} className={`min-h-11 px-4 text-sm font-semibold ${mode === "edit" ? "bg-action text-on-action" : ""}`} onClick={() => setMode("edit")}>Edit</button>
                <button type="button" aria-pressed={mode === "preview"} className={`min-h-11 px-4 text-sm font-semibold ${mode === "preview" ? "bg-action text-on-action" : ""}`} onClick={() => setMode("preview")}>Preview</button>
              </div>
            </div>

            <div ref={editorRef} tabIndex={-1} className={`${mode === "preview" ? "hidden xl:block" : ""} min-w-0 outline-none`}>
              <Card>
                {field ? (
                  <FieldEditor
                    key={field.key}
                    field={field}
                    value={values[field.key]}
                    defaultValue={defaults[field.key]}
                    live={liveEffective[field.key]}
                    facts={props.facts}
                    assets={assets}
                    nowIso={props.nowIso}
                    onChange={setValue}
                    onUploaded={(asset) => setAssets((prev) => (prev.some((a) => a.id === asset.id) ? prev : [asset, ...prev]))}
                  />
                ) : (
                  <p className="text-sm text-ink-soft">Choose a page and a section to change its words, buttons or pictures. You can also click anything in the preview.</p>
                )}
              </Card>
            </div>

            <div className={`${mode === "edit" ? "hidden xl:block" : ""} min-w-0`}>
              <Card title="Preview" description="Click any words, button or photo to edit it. Your latest saved draft is shown; save to refresh.">
                {page?.note && <p className="mb-3 text-sm text-ink-soft">{page.note}</p>}
                {previewSrc ? (
                  <iframe key={previewSrc} title={`Preview of ${page?.name}`} src={previewSrc} className="h-[28rem] w-full rounded-control border border-line bg-surface xl:h-[40rem]" />
                ) : (
                  <p className="text-sm text-ink-soft">{page?.previewPath ? "Save a draft or publish once to see a preview here." : "This part is not shown on a page, so there is nothing to look at. Use the list to choose what to change."}</p>
                )}
                <p className="mt-3 text-xs text-ink-soft">Prefer the keyboard? Use the lists on the left instead; they reach everything the preview does.</p>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <div className="sticky bottom-[4.75rem] z-20 mt-6 rounded-card border border-line bg-surface p-3 shadow lg:bottom-0">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <p aria-live="polite" className="min-w-0 flex-1 text-sm text-ink">{status}</p>
          <Link href="/desk/settings/website" onClick={leave} className="inline-flex min-h-11 items-center px-3 text-sm underline">Overview</Link>
          <Button variant="secondary" disabled={saving || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save draft"}</Button>
          <Button variant="secondary" onClick={() => { setMode("preview"); setStep("edit"); setNonce((n) => n + 1); }}>Preview</Button>
          <Button disabled={saving || (!dirty && !draft) || (!dirty && changeCount === 0)} onClick={() => void review()}>Review {changeCount} {changeCount === 1 ? "change" : "changes"}</Button>
        </div>
      </div>
    </div>
  );
}
