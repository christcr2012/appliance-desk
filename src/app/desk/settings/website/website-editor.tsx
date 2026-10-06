"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  StatusPill,
  Textarea,
} from "@/components/ui";
import {
  publishWebsiteDraftAction,
  restoreWebsiteVersionAction,
  saveWebsiteDraftAction,
} from "./actions";

type FieldDefinition = {
  key: string;
  label: string;
  help: string;
  kind: "short" | "paragraph" | "url" | "alt" | "meta";
  page: string;
  section: string;
  ownerInput?: string;
  default: string;
};

type HistoryRow = {
  id: string;
  version: number;
  live: boolean;
  when: string;
  by: string | null;
  note: string | null;
};

const MAX: Record<FieldDefinition["kind"], number> = {
  short: 120,
  paragraph: 2000,
  url: 500,
  alt: 160,
  meta: 160,
};

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
  fields: FieldDefinition[];
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
  const [message, setMessage] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);

  const dirty = useMemo(
    () =>
      fields.some(
        (field) =>
          (values[field.key] ?? "") !== (saved[field.key] ?? ""),
      ),
    [fields, values, saved],
  );
  const changedFromLive = useMemo(
    () =>
      fields.filter(
        (field) =>
          (saved[field.key] ?? "") !== (live[field.key] ?? ""),
      ),
    [fields, saved, live],
  );

  const groups = useMemo(() => {
    const out: {
      page: string;
      sections: { section: string; items: FieldDefinition[] }[];
    }[] = [];
    for (const field of fields) {
      let page = out.find((item) => item.page === field.page);
      if (!page) {
        page = { page: field.page, sections: [] };
        out.push(page);
      }
      let section = page.sections.find(
        (item) => item.section === field.section,
      );
      if (!section) {
        section = { section: field.section, items: [] };
        page.sections.push(section);
      }
      section.items.push(field);
    }
    return out;
  }, [fields]);

  async function save() {
    setBusy(true);
    setMessage(null);
    setConfirming(false);
    try {
      const changes: Record<string, string> = {};
      for (const field of fields) {
        const value = (values[field.key] ?? "").trim();
        if (value !== (defaults[field.key] ?? "")) {
          changes[field.key] = value;
        }
      }
      const result = await saveWebsiteDraftAction({
        draftId: draftRef?.id,
        expectedVersion: draftRef?.version,
        fields: changes,
      });
      if (result.status === "saved") {
        setDraftRef({
          id: result.draftId,
          version: result.version,
        });
        setSaved(values);
        setMessage({
          kind: "success",
          text: "Draft saved. Visitors still see the old text until you publish.",
        });
      } else if (result.status === "error") {
        setMessage({ kind: "error", text: result.message });
      }
    } catch {
      setMessage({
        kind: "error",
        text: "That could not be saved. Your changes are still on the screen; please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!draftRef) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await publishWebsiteDraftAction(
        draftRef.id,
        draftRef.version,
      );
      if (result.status === "done") {
        setConfirming(false);
        setMessage({
          kind: "success",
          text: "Published. The public website now shows your text.",
        });
        router.refresh();
      } else if (result.status === "error") {
        setMessage({ kind: "error", text: result.message });
      }
    } catch {
      setMessage({
        kind: "error",
        text: "That could not be published. Please try again.",
      });
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
        setMessage({
          kind: "success",
          text: `Version ${version} is live again (saved as a new version).`,
        });
        router.refresh();
      } else if (result.status === "error") {
        setMessage({ kind: "error", text: result.message });
      }
    } catch {
      setMessage({
        kind: "error",
        text: "That could not be restored. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-8">
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-control border border-line bg-subtle px-4 py-3 text-sm font-medium ${
            message.kind === "success" ? "text-success" : "text-danger"
          }`}
        >
          {message.text}
        </p>
      )}

      {groups.map((group) => (
        <Card
          key={group.page}
          title={group.page}
          actions={
            draftRef && PREVIEW_PATH[group.page] ? (
              <ButtonLink
                href={`${PREVIEW_PATH[group.page]}?revision=${draftRef.id}`}
                variant="secondary"
                target="_blank"
                rel="noopener noreferrer"
              >
                Preview {group.page.toLowerCase()} with my saved draft (opens a new tab)
              </ButtonLink>
            ) : undefined
          }
        >
          <div className="space-y-6">
            {group.sections.map((section) => (
              <fieldset key={section.section} className="space-y-5">
                <legend className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                  {section.section}
                </legend>

                {section.items.map((field) => {
                  const id = `f-${field.key}`;
                  const value = values[field.key] ?? "";
                  const max = MAX[field.kind];
                  const multiline = field.kind === "paragraph";

                  return (
                    <div key={field.key} className="space-y-2">
                      {field.ownerInput && (
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill tone="attention" label="Needs your decision" />
                          <span className="text-xs text-warning-ink">
                            {field.ownerInput} — it stays as it is until you change it.
                          </span>
                        </div>
                      )}

                      <div
                        className={
                          THUMBS[field.key]
                            ? "flex items-start gap-3"
                            : undefined
                        }
                      >
                        {THUMBS[field.key] && (
                          // eslint-disable-next-line @next/next/no-img-element -- fixed preview of a /public asset
                          <img
                            src={THUMBS[field.key]}
                            alt=""
                            width={96}
                            height={64}
                            className="mt-8 h-16 w-24 rounded-control object-cover"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          {multiline ? (
                            <Textarea
                              id={id}
                              label={field.label}
                              rows={4}
                              value={value}
                              maxLength={max}
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [field.key]: event.target.value,
                                }))
                              }
                            />
                          ) : (
                            <Field
                              id={id}
                              label={field.label}
                              type="text"
                              value={value}
                              maxLength={max}
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [field.key]: event.target.value,
                                }))
                              }
                            />
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-ink-soft">
                        {field.help}{" "}
                        <span>
                          ({value.length} of {max} characters.)
                        </span>
                        {value !== (defaults[field.key] ?? "") && (
                          <>
                            {" "}
                            <button
                              type="button"
                              className="font-semibold text-ink underline underline-offset-4"
                              onClick={() =>
                                setValues((current) => ({
                                  ...current,
                                  [field.key]: defaults[field.key] ?? "",
                                }))
                              }
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
          </div>
        </Card>
      ))}

      <div className="sticky bottom-0 z-10 rounded-card border border-line bg-surface p-4 shadow">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={busy || !dirty}
            onClick={save}
          >
            Save draft
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={
              busy ||
              dirty ||
              !draftRef ||
              changedFromLive.length === 0
            }
            onClick={() => setConfirming(true)}
          >
            Publish…
          </Button>
          <span className="text-sm text-ink-soft">
            {dirty
              ? "You have changes that are not saved yet. Save the draft first."
              : !draftRef
                ? "No draft yet."
                : changedFromLive.length === 0
                  ? "Your draft matches what is live."
                  : `${changedFromLive.length} change${
                      changedFromLive.length === 1 ? "" : "s"
                    } waiting to be published.`}
          </span>
        </div>

        {confirming && (
          <div
            role="group"
            aria-label="Confirm publishing"
            className="mt-4 rounded-card border border-warning-ink bg-warning-bg p-4 text-sm text-ink"
          >
            <p className="font-semibold">
              Publish these changes to the public website?
            </p>
            <ul className="mt-2 list-disc pl-5">
              {changedFromLive.map((field) => (
                <li key={field.key}>
                  {field.page} — {field.section}: {field.label}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button
                type="button"
                disabled={busy}
                onClick={publish}
              >
                Publish now
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Not yet
              </Button>
            </div>
          </div>
        )}
      </div>

      <Card title="History">
        {history.length === 0 ? (
          <EmptyState
            title="Nothing has been published yet"
            description="The website is still showing its original text."
          />
        ) : (
          <ul className="divide-y divide-line">
            {history.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <span>
                  <strong>Version {item.version}</strong>
                  {item.live ? " — live now" : ""} · {item.when}
                  {item.by ? ` · by ${item.by}` : ""}
                  {item.note ? ` · ${item.note}` : ""}
                </span>
                {!item.live && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => restore(item.id, item.version)}
                  >
                    Restore this version
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
