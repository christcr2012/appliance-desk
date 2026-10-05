"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { publishChecklistAction } from "./actions";

export function ChecklistEditor({ currentVersion, startingItems }: { currentVersion: number; startingItems: string[] }) {
  const router = useRouter();
  const [text, setText] = useState(startingItems.join("\n"));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const changed = lines.join("\n") !== startingItems.join("\n");

  async function publish() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await publishChecklistAction({ items: text.split("\n"), expectedCurrentVersion: currentVersion });
      if (result.status === "success") {
        setConfirming(false);
        setMessage({ kind: "success", text: `Version ${result.version} is now the checklist used for new inspections.` });
        router.refresh();
      } else setMessage({ kind: "error", text: result.message });
    } catch {
      setMessage({ kind: "error", text: "That could not be published. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`rounded-lg px-4 py-3 text-sm ${message.kind === "success" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>
          {message.text}
        </p>
      )}
      <div>
        <label htmlFor="checklist-items" className="block text-sm font-medium text-gray-900">
          Checklist items (one per line)
        </label>
        <textarea
          id="checklist-items"
          aria-describedby="checklist-help"
          rows={10}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setConfirming(false);
          }}
          className="mt-1 w-full rounded-lg border border-gray-400 px-3 py-2 text-sm"
        />
        <p id="checklist-help" className="mt-1 text-xs text-gray-600">
          {lines.length} item(s). Between 1 and 40 items, each 2 to 200 characters. Repeated lines are dropped.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy || !changed || lines.length === 0} onClick={() => setConfirming(true)} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">
          Publish new version…
        </button>
        <button type="button" disabled={busy || !changed} onClick={() => setText(startingItems.join("\n"))} className="inline-flex min-h-11 items-center rounded-lg border border-gray-400 px-4 text-sm font-semibold text-ink disabled:opacity-50">
          Undo my edits
        </button>
      </div>
      {confirming && (
        <div role="group" aria-label="Confirm publishing" className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-ink">
          <p className="font-semibold">Publish this as version {currentVersion + 1}?</p>
          <p className="mt-1">
            It applies to inspections recorded from now on. Inspections already recorded keep the questions they were
            answered against and are not changed.
          </p>
          <div className="mt-3 flex gap-3">
            <button type="button" disabled={busy} onClick={publish} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white">
              Publish now
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="inline-flex min-h-11 items-center rounded-lg border border-gray-400 px-4 text-sm font-semibold text-ink">
              Not yet
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
