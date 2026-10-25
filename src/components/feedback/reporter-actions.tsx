"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { Button, Textarea } from "@/components/ui";
import {
  addFeedbackDetailsAction, addFeedbackScreenshotAction, closeMyFeedbackAction, reopenMyFeedbackAction,
  type FeedbackActionResult,
} from "./actions";
import { shrinkScreenshot } from "./shrink-image";

type Mode = "question" | "open" | "reopen" | "none";

/** MCP-10a: what the sender can do on their own report, by its state. */
export function ReporterActions({
  id, version, mode, canAddPictures, picturesLeft, reopenDays,
}: {
  id: string; version: number; mode: Mode; canAddPictures: boolean; picturesLeft: number; reopenDays: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uid = useId();

  function done(result: FeedbackActionResult, success: string) {
    if (result.status !== "success") {
      setError(result.message);
      return;
    }
    setMessage("");
    setNotice(success);
    router.refresh();
  }

  function send(kind: "details" | "reopen") {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = kind === "reopen"
        ? await reopenMyFeedbackAction(id, version, message)
        : await addFeedbackDetailsAction(id, version, message);
      done(result, kind === "reopen" ? "Your report was reopened." : "Sent. We'll answer here.");
    });
  }

  function close() {
    setError(null);
    startTransition(async () => {
      done(await closeMyFeedbackAction(id, version), "This report is closed.");
      setConfirmClose(false);
    });
  }

  async function addPictures(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    setNotice(null);
    let saved = 0;
    for (const file of Array.from(list).slice(0, picturesLeft)) {
      const shrunk = await shrinkScreenshot(file);
      if (!shrunk.ok) {
        setError(shrunk.message);
        continue;
      }
      const form = new FormData();
      form.set("file", shrunk.file);
      const result = await addFeedbackScreenshotAction(id, form);
      if (result.status === "saved") saved += 1;
      else setError(result.message);
      if (result.status === "unavailable") break;
    }
    if (fileInput.current) fileInput.current.value = "";
    if (saved) setNotice(saved === 1 ? "Picture added." : `${saved} pictures added.`);
    router.refresh();
  }

  if (mode === "none") return null;
  return (
    <section aria-label="What you can do" className="space-y-4 rounded-card border border-line bg-surface p-4 sm:p-6">
      {mode === "reopen" ? (
        <>
          <h2 className="text-lg font-semibold text-ink">It&apos;s still not right</h2>
          <Textarea
            label="What is still wrong?"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={500}
            rows={3}
            help={`You can reopen a finished report for ${reopenDays} days.`}
          />
          <Button onClick={() => send("reopen")} disabled={pending || message.trim().length < 3}>Reopen this report</Button>
        </>
      ) : (
        <>
          <h2 className="text-lg font-semibold text-ink">{mode === "question" ? "Answer" : "Add details"}</h2>
          <Textarea
            label={mode === "question" ? "Your answer" : "More details"}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={4000}
            rows={4}
            required={mode === "question"}
          />
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => send("details")} disabled={pending || !message.trim()}>Send</Button>
            {!confirmClose ? (
              <Button variant="secondary" onClick={() => setConfirmClose(true)} disabled={pending}>Close this report</Button>
            ) : (
              <span className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-ink">Close it? You can reopen it later if something is still wrong.</span>
                <Button variant="danger" onClick={close} disabled={pending}>Yes, close it</Button>
                <Button variant="quiet" onClick={() => setConfirmClose(false)}>Keep it open</Button>
              </span>
            )}
          </div>
          {canAddPictures && (
            <div className="space-y-1">
              <label htmlFor={`${uid}-pictures`} className="block text-sm font-semibold text-ink">Add screenshots</label>
              <p id={`${uid}-help`} className="text-xs text-ink-soft">{picturesLeft} left. PNG, JPEG or WebP.</p>
              <input
                ref={fileInput}
                id={`${uid}-pictures`}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                aria-describedby={`${uid}-help`}
                onChange={(event) => void addPictures(event.target.files)}
                className="block min-h-11 w-full text-sm text-ink"
              />
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm font-semibold text-ink">{notice}</p>}
    </section>
  );
}
