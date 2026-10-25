"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { StatusPill, actionButtonClass, toast, type Tone } from "@/components/kit";
import type { AnswerPreview, ApplyResult, ParsedAnswer } from "@/domains/decisions";

// DEC-1b: upload the completed Word form (or paste the answers), see exactly what would change, then apply it.
// The confirm token from the preview makes sure what is applied is exactly what was shown.

type Preview = {
  preview: AnswerPreview[];
  confirmToken: string;
  answers: ParsedAnswer[];
  unanswered: string[];
  attachmentHandle: string | null;
  file: "KEPT" | "NO_FILE" | "NOT_KEPT";
};

const STATUS: Record<AnswerPreview["status"], { label: string; tone: Tone }> = {
  CHANGE: { label: "Will change", tone: "attention" },
  SAME: { label: "No change — confirms it", tone: "good" },
  OTHER: { label: "Needs a change to the app", tone: "info" },
  INVALID: { label: "Can't apply", tone: "danger" },
};

const BUTTON = (variant: "primary" | "secondary") =>
  actionButtonClass({ spec: { kind: "link", label: "", href: "" }, variant });

function dateWords(key: string | null) {
  return key ? key : "Right away";
}

export function ImportForm() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const read = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    setResult(null);
    start(async () => {
      try {
        const response = await fetch("/api/desk/decisions/import", { method: "POST", body: data });
        const body = await response.json().catch(() => ({})) as Preview & { error?: string };
        if (!response.ok) { setError(body.error ?? "That form couldn't be read. Try again."); setPreview(null); return; }
        setPreview(body);
      } catch {
        setError("That form couldn't be read. Check your connection and try again.");
      }
    });
  };

  const apply = () => {
    if (!preview) return;
    setError(null);
    start(async () => {
      try {
        const response = await fetch("/api/desk/decisions/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: preview.answers, confirmToken: preview.confirmToken,
            attachmentHandle: preview.attachmentHandle }),
        });
        const body = await response.json().catch(() => ({})) as ApplyResult & { error?: string };
        if (!response.ok) { setError(body.error ?? "Nothing was applied. Preview the answers again."); return; }
        setResult(body);
        setPreview(null);
        toast({ message: `Applied ${body.applied} ${body.applied === 1 ? "change" : "changes"}.`, tone: "good" });
      } catch {
        setError("Nothing was applied. Check your connection and try again.");
      }
    });
  };

  if (result) {
    return (
      <section aria-label="Applied" className="space-y-3 rounded-card border border-line bg-surface px-4 py-3.5">
        <h2 className="text-base font-bold text-ink">Done</h2>
        <ul className="list-disc space-y-1 pl-5 text-[15px] text-ink">
          <li>Changed: {result.applied}</li>
          <li>Confirmed with no change: {result.same}</li>
          <li>Kept as answers that need a change to the app: {result.other}</li>
          <li>Skipped (couldn&apos;t apply): {result.skipped}</li>
        </ul>
        <Link href="/desk/settings/decisions?for=ANSWERED" className={BUTTON("primary")}>See answered questions</Link>
      </section>
    );
  }

  const changes = preview?.preview.filter((row) => row.status === "CHANGE").length ?? 0;
  const usable = preview?.preview.filter((row) => row.status !== "INVALID").length ?? 0;

  return (
    <div className="space-y-5">
      <form onSubmit={read} className="space-y-4 rounded-card border border-line bg-surface px-4 py-3.5">
        <label className="block text-sm font-bold text-ink">
          Completed Word form (.docx, up to 4 MB)
          <input type="file" name="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="mt-1 block w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-field file:border file:border-line-strong file:bg-surface file:px-3 file:font-bold" />
        </label>
        <label className="block text-sm font-bold text-ink">
          Or paste the answers (for a PDF or a scan)
          <textarea name="text" rows={6} maxLength={300000}
            className="mt-1 block w-full rounded-field border border-line-strong bg-surface px-3 py-2 text-[15px] text-ink" />
        </label>
        <button type="submit" disabled={pending} className={BUTTON("primary")}>{pending && !preview ? "Reading…" : "Preview answers"}</button>
      </form>

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

      {preview ? (
        <section aria-label="What would change" className="space-y-3">
          <h2 className="text-base font-bold text-ink">What would change</h2>
          {preview.file === "NOT_KEPT" ? (
            <p className="text-sm text-ink-soft">The form itself can&apos;t be kept here (file storage isn&apos;t set up). The answers can still be applied.</p>
          ) : null}
          {preview.unanswered.length > 0 ? (
            <p className="text-sm text-ink-soft">Left blank: {preview.unanswered.length} {preview.unanswered.length === 1 ? "question" : "questions"} (nothing changes for them).</p>
          ) : null}
          <ul className="flex flex-col gap-2.5 lg:hidden">
            {preview.preview.map((row, index) => (
              <li key={`${row.code}-${index}`} className="rounded-card border border-line bg-surface px-4 py-3.5 text-sm">
                <p className="font-bold text-ink">{row.title}</p>
                <p className="text-ink-soft">DQ-{row.code}</p>
                <p className="mt-1 text-ink">Now: {row.now || "—"}</p>
                <p className="text-ink">After: {row.after || "—"}</p>
                <p className="text-ink">Starts: {dateWords(row.effectiveFrom)}</p>
                <p className="mt-1"><StatusPill label={STATUS[row.status].label} tone={STATUS[row.status].tone} /></p>
                {row.reason ? <p className="mt-1 text-danger">{row.reason}</p> : null}
              </li>
            ))}
          </ul>
          <table className="hidden w-full border-collapse text-left text-sm lg:table">
            <caption className="sr-only">Answers from the form and what each would do</caption>
            <thead>
              <tr className="border-b border-line text-ink-soft">
                <th scope="col" className="py-2 pr-3">Code</th>
                <th scope="col" className="py-2 pr-3">Question</th>
                <th scope="col" className="py-2 pr-3">Now → after</th>
                <th scope="col" className="py-2 pr-3">Starts</th>
                <th scope="col" className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.preview.map((row, index) => (
                <tr key={`${row.code}-${index}`} className="border-b border-line align-top">
                  <td className="py-2 pr-3 text-ink-soft">DQ-{row.code}</td>
                  <td className="py-2 pr-3 font-semibold text-ink">{row.title}</td>
                  <td className="py-2 pr-3 text-ink">{row.now || "—"} → {row.after || "—"}</td>
                  <td className="py-2 pr-3 text-ink">{dateWords(row.effectiveFrom)}</td>
                  <td className="py-2">
                    <StatusPill label={STATUS[row.status].label} tone={STATUS[row.status].tone} />
                    {row.reason ? <p className="mt-1 text-danger">{row.reason}</p> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {usable > 0 ? (
            <button type="button" onClick={apply} disabled={pending} className={BUTTON("primary")}>
              {pending ? "Applying…" : changes > 0 ? `Apply ${changes} ${changes === 1 ? "change" : "changes"}` : "Record their answers"}
            </button>
          ) : (
            <p className="text-sm text-ink">None of these answers can be applied. Fix the form and preview it again.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
