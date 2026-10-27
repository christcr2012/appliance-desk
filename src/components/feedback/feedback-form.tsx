"use client";

import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { Button, Field, Textarea } from "@/components/ui";
import { addFeedbackScreenshotAction, submitFeedbackAction } from "./actions";
import { shrinkScreenshot } from "./shrink-image";

export type FeedbackArea = "desk" | "account";

type Picture = { key: string; file: File; name: string };

function newRequestKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * MCP-10a "Tell us about the app" — the same form in the desk and the customer portal. The report is sent first
 * (without pictures); each picture then goes in its own request after being shrunk in the browser.
 */
export function FeedbackForm({
  area,
  from,
  maxAttachments,
  contextSummary,
}: {
  area: FeedbackArea;
  /** The page the person came from (never shown; the server stores only its shape). */
  from: string;
  maxAttachments: number;
  /** "Page: Rentals › a record · App version abc123 · Safari on a phone" */
  contextSummary: string;
}) {
  const [requestKey] = useState(newRequestKey);
  const [kind, setKind] = useState<"BUG" | "IMPROVEMENT">("BUG");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [expected, setExpected] = useState("");
  const [steps, setSteps] = useState("");
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ number: number; notes: string[] } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const kindName = useId();
  const mine = area === "account" ? "/account/feedback" : "/desk/feedback/mine";
  const left = Math.max(0, maxAttachments - pictures.length);

  async function choosePictures(list: FileList | null) {
    setPictureError(null);
    if (!list || list.length === 0) return;
    const chosen = Array.from(list);
    if (chosen.length > left) {
      setPictureError(maxAttachments === 0 ? "Pictures are turned off for app feedback." : `You can add up to ${maxAttachments} pictures.`);
    }
    setPreparing(true);
    const ready: Picture[] = [];
    for (const file of chosen.slice(0, left)) {
      const result = await shrinkScreenshot(file);
      if (result.ok) ready.push({ key: newRequestKey(), file: result.file, name: file.name });
      else setPictureError(result.message);
    }
    setPictures((current) => [...current, ...ready].slice(0, maxAttachments));
    setPreparing(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || preparing) return;
    setError(null);
    startTransition(async () => {
      const result = await submitFeedbackAction({
        kind, title, description, expected: kind === "BUG" ? expected : "", steps: kind === "BUG" ? steps : "",
        path: from, requestKey,
      }).catch(() => ({ status: "error" as const, message: "That didn't go through. Your text is still here — please try again." }));
      if (result.status !== "success") {
        setError(result.message);
        return;
      }
      const notes: string[] = [];
      for (const picture of pictures.slice(0, result.maxAttachments)) {
        const form = new FormData();
        form.set("file", picture.file);
        const saved = await addFeedbackScreenshotAction(result.id, form).catch(() => ({
          status: "error" as const, message: "A picture couldn't be sent.",
        }));
        if (saved.status === "unavailable") {
          notes.push(saved.message);
          break;
        }
        if (saved.status === "error") notes.push(`${picture.name}: ${saved.message}`);
      }
      setSent({ number: result.number, notes });
    });
  }

  if (sent) {
    return (
      <section aria-live="polite" className="space-y-4 rounded-card border border-line bg-surface p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-ink">Thanks — report #{sent.number} was sent. We&apos;ll answer here.</h2>
        {sent.notes.map((note) => (
          <p key={note} role="status" className="text-sm font-semibold text-ink">{note}</p>
        ))}
        <Link href={mine} className="inline-flex min-h-11 items-center rounded-control bg-action px-4 py-2 text-sm font-semibold text-on-action">
          See my reports
        </Link>
      </section>
    );
  }

  const busy = pending || preparing;
  return (
    <form onSubmit={submit} className="min-w-0 space-y-5 [overflow-wrap:anywhere]" noValidate>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">What is this about?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {([["BUG", "Something isn't working"], ["IMPROVEMENT", "I have an idea"]] as const).map(([value, label]) => (
            <label
              key={value}
              className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-card border p-4 text-base font-semibold text-ink ${
                kind === value ? "border-action bg-subtle" : "border-line bg-surface"
              }`}
            >
              <input type="radio" name={kindName} value={value} checked={kind === value} onChange={() => setKind(value)} className="h-5 w-5" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <Field
        label={kind === "BUG" ? "What happened?" : "What's your idea?"}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={160}
        required
        help="A short summary (at least 5 characters)."
      />
      <Textarea
        label="Tell us more"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        maxLength={8000}
        rows={5}
        required
        help="At least 10 characters."
      />

      {kind === "BUG" && (
        <details className="rounded-card border border-line bg-surface p-4">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-ink">Add more detail</summary>
          <div className="mt-3 space-y-4">
            <Textarea label="What did you expect?" value={expected} onChange={(event) => setExpected(event.target.value)} maxLength={2000} rows={3} />
            <Textarea label="Steps, if you remember them" value={steps} onChange={(event) => setSteps(event.target.value)} maxLength={4000} rows={4} />
          </div>
        </details>
      )}

      {maxAttachments > 0 && (
        <div className="space-y-2">
          <label htmlFor={`${kindName}-pictures`} className="block text-sm font-semibold text-ink">Add screenshots</label>
          <p id={`${kindName}-pictures-help`} className="text-xs text-ink-soft">
            PNG, JPEG or WebP. {left} of {maxAttachments} left. Pictures are made smaller before they are sent.
          </p>
          <input
            ref={fileInput}
            id={`${kindName}-pictures`}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={busy || left === 0}
            aria-describedby={`${kindName}-pictures-help`}
            onChange={(event) => void choosePictures(event.target.files)}
            className="block min-h-11 w-full text-sm text-ink"
          />
          {preparing && <p role="status" className="text-sm text-ink-soft">Getting the pictures ready…</p>}
          {pictureError && <p role="alert" className="text-sm font-semibold text-danger">{pictureError}</p>}
          {pictures.length > 0 && (
            <ul className="space-y-2">
              {pictures.map((picture) => (
                <li key={picture.key} className="flex items-center justify-between gap-3 rounded-control border border-line px-3 py-2 text-sm text-ink">
                  <span className="min-w-0 truncate">{picture.name}</span>
                  <Button variant="quiet" onClick={() => setPictures((current) => current.filter((p) => p.key !== picture.key))}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section aria-labelledby={`${kindName}-context`} className="rounded-card bg-subtle p-4 text-sm">
        <h2 id={`${kindName}-context`} className="font-semibold text-ink">What we&apos;ll also see</h2>
        <p className="mt-1 text-ink-soft">{contextSummary}</p>
      </section>

      <p className="text-sm text-ink">Chris and his team read these. Don&apos;t include passwords, card numbers or access codes.</p>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      <Button type="submit" size="lg" disabled={busy} aria-disabled={busy}>
        {pending ? "Sending…" : "Send"}
      </Button>
    </form>
  );
}
