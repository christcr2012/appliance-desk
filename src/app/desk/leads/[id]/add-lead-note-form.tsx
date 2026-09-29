"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addLeadNoteAction } from "../actions";

/** Quick-action note form on a lead's own page — mirrors
 * src/app/desk/customers/[id]/add-note-form.tsx's CustomerNote pattern,
 * extended to leads (2026-09-29, Chris's CRM brainstorm — see
 * docs/DECISIONS.md). */
export function AddLeadNoteForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className="mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        const body = new FormData(e.currentTarget).get("body");
        if (typeof body !== "string") return;
        startTransition(async () => {
          const result = await addLeadNoteAction(leadId, body);
          if (result.status === "error") {
            setError(result.message);
            return;
          }
          setError(null);
          formRef.current?.reset();
          router.refresh();
        });
      }}
    >
      <label htmlFor="lead-note-body" className="sr-only">
        Add a note
      </label>
      <textarea
        id="lead-note-body"
        name="body"
        rows={2}
        required
        placeholder="Log a call, an email, a message — anything worth remembering next time…"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="mt-2 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Add note"}
      </button>
    </form>
  );
}
